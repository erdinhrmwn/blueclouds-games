// Actor-side helpers every game room shares: who is connected, the turn clock, leaving,
// the room list and the match result outbox. Each game keeps its own actor and actions.
import { createHash, timingSafeEqual } from "node:crypto";
import { UserError } from "rivetkit";
import {
	fetchRoomSeats,
	fetchVipIds,
	type Identity,
	markRoom,
	reportMatch,
	verifyPlayToken,
} from "../../platform";
import { fairRng, newCommitment, type NextMatch } from "./fair-rng";
import { clientSeedOf, type Revealed, type ShuffleRecord } from "./fairness";
import {
	type LogEntry,
	type LogEvent,
	type MatchEnd,
	type MatchReport,
	type MatchState,
	stamp,
} from "./match";
import { AdminParams, PlayerParams, SeatInput, tournamentListKey } from "./schema";
import {
	kickPlayer,
	markAway,
	removePlayer,
	randomRng,
	type Rng,
	RuleError,
	SEATS,
	showVips,
	type Table,
} from "./table";

/** How long a closed tab has to come back (a refresh) before its player leaves the table. */
export const GONE_AFTER_MS = 15_000;
/** A bot gets the same turn clock as a human; it just decides within this range (random). */
export const BOT_THINK_MS = [1500, 4000] as const;

const BOT_NAMES = ["Bot Cloud", "Bot Rain", "Bot Thunder", "Bot Rainbow", "Bot Wind"];

/** Wait before each retry of an unsent match result; the last one repeats forever. */
const REPORT_RETRY_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000];

/** The turn the timer belongs to (`moves` = the turn key), when it runs out (epoch ms), and its full length. */
export type TurnTimer = { moves: number; endsAt: number; total: number } | null;

/** How long a tournament room waits past its start time for late players (Erdin, 2026-11-11). */
export const LATE_GRACE_MS = 3 * 60_000;

/** How often a room with someone connected asks the platform who is VIP, so a grant or revoke reaches seated tags. */
export const VIP_REFRESH_MS = 30_000;

/** A tournament room as the actor knows it from the platform. `seats` maps each assigned player to their seat (null = any). */
export type TournamentRoom = {
	name: string;
	startsAt: number;
	cancelled: boolean;
	minPlayers: number;
	seats: Record<string, number | null>;
	closed: boolean;
};

/** An admin terminated the table: nobody plays or joins here again. */
export type Termination = { at: number; reason: string };

/**
 * What a room saves: the game, its turn timer, the match being played (null in the lobby), its
 * tournament (null = an open room, undefined = not asked yet), whether it is in the room list (public),
 * the players kicked off it (they can't come back), whether an admin terminated it, the seeds the
 * next match is committed to, and the seeds of the last match (revealed).
 */
export type Saved<G extends Table, M extends MatchState = MatchState> = {
	game: G;
	timer: TurnTimer;
	match: M | null;
	tournament?: TournamentRoom | null;
	listed?: boolean;
	kicked?: string[];
	terminated?: Termination | null;
	next?: NextMatch;
	revealed?: Revealed | null;
};

/**
 * What every room keeps in `c.vars`. Not saved: who each open connection is (connections close when
 * the actor sleeps), the game as last committed, to see what each commit changed for the move log,
 * when the running VIP check is due (null = none running), and the fairness entries (start, shuffles)
 * waiting for the next commit to log them.
 */
export type RoomVars<G extends Table, M extends MatchState = MatchState> = Saved<G, M> & {
	who: Record<string, Identity>;
	logged: G;
	vipCheckAt: number | null;
	fairLog: LogEntry[];
};

export const roomVars = <G extends Table, M extends MatchState>(game: G): RoomVars<G, M> => ({
	game,
	logged: game,
	who: {},
	vipCheckAt: null,
	timer: null,
	match: null,
	next: newCommitment(),
	revealed: null,
	fairLog: [],
});

/** The room's tables: one JSON row for the whole room (a few KB), the result outbox, and the move log. */
export async function migrateRoom(d: {
	execute: (sql: string) => Promise<unknown>;
}): Promise<void> {
	await d.execute(`
		CREATE TABLE IF NOT EXISTS room (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL
		)`);

	// Outbox: finished match results waiting to reach the platform.
	await d.execute(`
		CREATE TABLE IF NOT EXISTS match_reports (
			match_id TEXT PRIMARY KEY,
			body TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0
		)`);

	// Move log of the match being played; moved into its report when the match ends.
	await d.execute(`
		CREATE TABLE IF NOT EXISTS match_events (
			match_id TEXT NOT NULL,
			seq INTEGER NOT NULL,
			body TEXT NOT NULL,
			PRIMARY KEY (match_id, seq)
		)`);
}

/** onWake: loads the saved room into `c.vars`. */
export async function loadRoom(c: Ctx): Promise<void> {
	const [row] = await c.db.execute("SELECT data FROM room WHERE id = 1");
	if (row) Object.assign(c.vars, JSON.parse(row.data));

	c.vars.timer ??= null;
	c.vars.match ??= null;
	c.vars.kicked ??= [];
	c.vars.terminated ??= null;
	c.vars.next ??= newCommitment();
	c.vars.revealed ??= null;
	c.vars.fairLog = [];

	// Matches started before the move log have no seq yet.
	if (c.vars.match) c.vars.match.seq ??= 0;

	c.vars.logged = c.vars.game;
}

/**
 * After every change: arm the turn clock (`scheduleTurn`), log what changed, save room + log in one
 * transaction (so the log never skips or repeats a move), then push the view to everyone and each
 * hand to its owner. When the game just finished, or an admin terminated the table mid-match, its
 * result and full log go to the outbox. `auto` marks a move the server made (bot, timeout or away
 * player) for the move log; `extra` is logged before what the game's own diff finds (a kick, a
 * termination).
 */
export async function commitRoom<G extends Table, M extends MatchState>(
	c: Ctx,
	game: {
		slug: string;
		scheduleTurn: () => Promise<void>;
		logEvents: (before: G, after: G, auto: boolean) => LogEntry[];
		/** Updates the match record after each move (e.g. who was knocked out). */
		noteMove?: (match: M, game: G) => M;
		buildReport: (
			match: M,
			game: G,
			roomCode: string,
			endedAt: string,
			log: LogEvent[],
			end: MatchEnd,
		) => MatchReport;
		view: () => unknown;
		handOf: (playerId: string) => unknown;
	},
	auto = false,
	extra: LogEntry[] = [],
): Promise<void> {
	const vars = c.vars as RoomVars<G, M>;

	// A terminated table runs no clock: nothing moves there again.
	if (vars.terminated) {
		vars.timer = null;
	} else {
		await game.scheduleTurn();
	}

	let end: MatchEnd | null = null;
	if (vars.match && vars.terminated) {
		end = "terminated";
	} else if (vars.match && vars.game.phase === "finished") {
		end = "finished";
	}

	const finished = end !== null;
	const seeds = vars.match?.seeds;
	const reveal: LogEntry[] =
		finished && seeds ? [{ type: "reveal", data: { serverSeed: seeds.serverSeed } }] : [];

	const entries = vars.match
		? [
				...extra,
				...vars.fairLog,
				...withoutKickedAway(extra, game.logEvents(vars.logged, vars.game, auto)),
				...reveal,
			]
		: [];
	vars.logged = vars.game;
	vars.fairLog = [];

	let match = vars.match;
	let events: LogEvent[] = [];
	if (match) {
		const noted = game.noteMove ? game.noteMove(match, vars.game) : match;
		({ match, events } = stamp(noted, entries, Date.now()));
	}

	vars.match = finished ? null : match;
	// Its shuffles are filled in from the log below, before the room is saved.
	if (finished && seeds) {
		vars.revealed = {
			matchId: seeds.matchId,
			serverSeedHash: seeds.serverSeedHash,
			serverSeed: seeds.serverSeed,
			clientSeed: seeds.clientSeed,
			shuffles: [],
		};
	}

	const saved: Saved<G, M> = {
		game: vars.game,
		timer: vars.timer,
		match: vars.match,
		tournament: vars.tournament,
		listed: vars.listed,
		kicked: vars.kicked,
		terminated: vars.terminated,
		next: vars.next,
		revealed: vars.revealed,
	};
	await c.db.transaction(
		async (tx: Ctx) => {
			for (const event of events) {
				await tx.execute(
					"INSERT INTO match_events (match_id, seq, body) VALUES (?, ?, ?)",
					match!.id,
					event.seq,
					JSON.stringify(event),
				);
			}

			if (finished) {
				const rows = await tx.execute(
					"SELECT body FROM match_events WHERE match_id = ? ORDER BY seq",
					match!.id,
				);
				const log: LogEvent[] = rows.map(
					(row: { body: string }) => JSON.parse(row.body) as LogEvent,
				);
				if (seeds && vars.revealed) {
					vars.revealed.shuffles = log
						.filter((event) => event.type === "shuffle")
						.map((event) => event.data as ShuffleRecord);
				}
				const roomCode = c.key[0] as string;
				const endedAt = new Date().toISOString();
				const built = game.buildReport(match!, vars.game, roomCode, endedAt, log, end!);
				const report: MatchReport = seeds
					? {
							...built,
							fairness: {
								serverSeed: seeds.serverSeed,
								serverSeedHash: seeds.serverSeedHash,
								clientSeed: seeds.clientSeed,
							},
						}
					: built;

				await tx.execute(
					"INSERT OR IGNORE INTO match_reports (match_id, body) VALUES (?, ?)",
					report.matchId,
					JSON.stringify(report),
				);
				await tx.execute("DELETE FROM match_events WHERE match_id = ?", match!.id);
			}

			await tx.execute(
				`INSERT INTO room (id, data) VALUES (1, ?)
				ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
				JSON.stringify(saved),
			);
		},
		{ name: "commit" },
	);

	c.broadcast("view", game.view());
	for (const conn of c.conns.values()) {
		const playerId = playerOf(c, conn);
		if (playerId) conn.send("hand", game.handOf(playerId));
	}

	// After the players got their update, so the list never slows a move.
	await reportToDirectory(c, game.slug);

	if (finished) await c.schedule.after(0, "sendReports");
}

/**
 * Starts a match on the seeds the room committed to before it: the committed match id and server seed, with
 * the seating as part of the client seed. `start` deals with the room's fair rng; `extra` fills the game's own
 * match fields. If `start` refuses (a rule), nothing changed. The next match gets a new commitment.
 */
export function beginMatch<G extends Table, M extends MatchState>(
	c: Ctx,
	extra: Omit<M, keyof MatchState>,
	start: (rng: Rng) => G,
): void {
	const vars = c.vars as RoomVars<G, M>;
	const next = vars.next!;
	const seats = vars.game.players.map((player) => ({
		seat: player.seat,
		playerId: player.bot ? null : player.id,
		botName: player.name,
	}));
	const clientSeed = clientSeedOf(next.matchId, seats);

	const match = {
		...extra,
		id: next.matchId,
		startedAt: new Date().toISOString(),
		seq: 0,
		seeds: { ...next, clientSeed, nonce: 0 },
	} as M;

	vars.match = match;
	vars.fairLog = [{ type: "fairness", data: { serverSeedHash: next.serverSeedHash, clientSeed } }];

	try {
		vars.game = withRng(c, start);
	} catch (err) {
		vars.match = null;
		vars.fairLog = [];
		throw err;
	}

	vars.next = newCommitment();
}

/**
 * Runs a move with the room's rng, as `apply` does. A move the rules refuse may have shuffled first: its nonce
 * and log entries are taken back, so the log only ever holds shuffles the game kept.
 */
export function withRng<G>(c: Ctx, move: (rng: Rng) => G): G {
	const vars = c.vars as RoomVars<Table>;
	const match = vars.match;
	const pending = vars.fairLog.length;

	try {
		return apply(() => move(roomRng(c)));
	} catch (err) {
		vars.match = match;
		vars.fairLog = vars.fairLog.slice(0, pending);
		throw err;
	}
}

/**
 * The rng a room deals with: the running match's seeds, counting the nonce up and logging each shuffle. A match
 * started before provably fair shuffles keeps a plain random one.
 */
function roomRng(c: Ctx): Rng {
	const vars = c.vars as RoomVars<Table>;
	if (!vars.match?.seeds) {
		return randomRng();
	}

	return fairRng(
		() => vars.match!.seeds!,
		(record) => {
			const seeds = vars.match!.seeds!;
			vars.match = { ...vars.match!, seeds: { ...seeds, nonce: seeds.nonce + 1 } };
			vars.fairLog.push({ type: "shuffle", data: record });
		},
	);
}

/**
 * What the table shows about fairness: the commitment of the match being played (or of the next one, in the
 * lobby) and the seeds of the last match, revealed.
 */
export function fairnessView(c: Ctx) {
	const vars = c.vars as RoomVars<Table>;
	const seeds = vars.match?.seeds;
	const current = seeds
		? { matchId: seeds.matchId, serverSeedHash: seeds.serverSeedHash, clientSeed: seeds.clientSeed }
		: { matchId: vars.next!.matchId, serverSeedHash: vars.next!.serverSeedHash, clientSeed: null };

	let revealed: Omit<Revealed, "shuffles"> | null = null;
	if (vars.revealed) {
		const { shuffles: _, ...seedsOnly } = vars.revealed;
		revealed = seedsOnly;
	}

	return { ...current, revealed };
}

/** The last match's seeds and every shuffle in it, for anyone at the table to check (null before any). */
export function lastProof(c: Ctx): Revealed | null {
	return (c.vars as RoomVars<Table>).revealed ?? null;
}

/** A kicked player's chair turns "away" in the game's diff; the "kicked" entry already says so. */
function withoutKickedAway(extra: LogEntry[], entries: LogEntry[]): LogEntry[] {
	const kickedSeats = extra.filter((entry) => entry.type === "kicked").map((entry) => entry.seat);

	return entries.filter((entry) => entry.type !== "away" || !kickedSeats.includes(entry.seat));
}

// ponytail: helpers take `any` because rivetkit's context generics are long;
// they only touch c.vars, c.conn, c.db, c.conns, c.key, c.log, c.client() and c.schedule.
export type Ctx = any;

/** Turns rule violations into errors the client is allowed to see. */
export function apply<T>(fn: () => T): T {
	try {
		return fn();
	} catch (err) {
		if (err instanceof RuleError) throw new UserError(err.message, { code: "rule" });
		throw err;
	}
}

export function parseSeat(input: unknown): number {
	const parsed = SeatInput.safeParse(input);
	if (!parsed.success) {
		throw new UserError("That seat does not exist.", { code: "bad_input" });
	}

	return parsed.data;
}

export function botName(players: { name: string }[]): string {
	const used = new Set(players.map((player) => player.name));
	const free = BOT_NAMES.find((name) => !used.has(name));

	return free ?? `Bot ${players.length + 1}`;
}

/** Every refusal of a closed table carries this code, so the browser stops trying to reconnect. */
export const TABLE_CLOSED = "table_closed";

const TERMINATED_MESSAGE = "An admin closed this table.";
const KICKED_MESSAGE = "You were removed from this table.";

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/**
 * Whether `key` is the engine's admin token, which only our servers hold (the backoffice uses it for admin
 * actions). Hashed first, so the comparison takes the same time whatever the length. No token set: never.
 */
function isAdminKey(key: string): boolean {
	const expected = process.env.RIVET_TOKEN;
	if (!expected) {
		return false;
	}

	return timingSafeEqual(sha256(key), sha256(expected));
}

/** The connection is the backoffice, with the admin token. */
function isAdminConn(conn: { params: unknown } | undefined): boolean {
	const parsed = AdminParams.safeParse(conn?.params);

	return parsed.success && isAdminKey(parsed.data.adminKey);
}

/** Throws when an admin terminated the table, or kicked this player off it. */
function refuseIfClosed(c: Ctx, playerId: string): void {
	if (c.vars.terminated) {
		throw new UserError(TERMINATED_MESSAGE, { code: TABLE_CLOSED });
	}
	if ((c.vars.kicked as string[]).includes(playerId)) {
		throw new UserError(KICKED_MESSAGE, { code: TABLE_CLOSED });
	}
}

/**
 * onBeforeConnect: only connections with a valid play token get in, or the backoffice with the admin token.
 * A terminated table, or one the player was kicked from, refuses them.
 */
export async function checkConnect(c: Ctx, params: unknown): Promise<void> {
	const admin = AdminParams.safeParse(params);
	if (admin.success) {
		if (isAdminKey(admin.data.adminKey)) {
			return;
		}

		throw new UserError("Not allowed.", { code: "forbidden" });
	}

	const player = PlayerParams.safeParse(params);
	const identity = player.success ? await verifyPlayToken(player.data.playToken) : null;
	if (!identity) {
		throw new UserError("Your session expired. Reload the page.", { code: "unauthenticated" });
	}

	refuseIfClosed(c, identity.id);
}

/**
 * onConnect: remembers who the connection is. Checked again because onBeforeConnect can't hand its result over.
 * Returns true for a player; the backoffice's connection is not one (it sits nowhere and gets no updates).
 */
export async function identify(
	c: Ctx,
	conn: { id: string; params: unknown; disconnect: (reason: string) => void },
): Promise<boolean> {
	if (isAdminConn(conn)) {
		return false;
	}

	const player = PlayerParams.safeParse(conn.params);
	const who = player.success ? await verifyPlayToken(player.data.playToken) : null;
	if (!who) {
		conn.disconnect("unauthenticated");
		return false;
	}

	c.vars.who[conn.id] = who;
	return true;
}

/** The identity of the connection calling an action. Refused at a closed table. */
export function caller(c: Ctx): Identity {
	const who = c.vars.who[c.conn.id] as Identity | undefined;
	if (!who) {
		throw new UserError("Your session expired. Reload the page.", { code: "unauthenticated" });
	}

	refuseIfClosed(c, who.id);
	return who;
}

/** For the backoffice's actions: the connection must carry the admin token. */
export function requireAdmin(c: Ctx): void {
	if (!isAdminConn(c.conn)) {
		throw new UserError("Not allowed.", { code: "forbidden" });
	}
}

/** The player a connection sits as, if they joined the table. */
export function playerOf(c: Ctx, conn: { id: string }): string | undefined {
	const id = (c.vars.who[conn.id] as Identity | undefined)?.id;
	if (!id) return undefined;

	const seated = (c.vars.game as Table).players.some((player) => player.id === id);
	return seated ? id : undefined;
}

export function requirePlayer(c: Ctx): string {
	const id = playerOf(c, c.conn);
	if (!id) {
		throw new UserError("Join the table first.", { code: "not_joined" });
	}

	refuseIfClosed(c, id);
	return id;
}

export function requireHost(c: Ctx): string {
	const me = requirePlayer(c);
	if ((c.vars.game as Table).hostId !== me) {
		throw new UserError("Only the host can do that.", { code: "rule" });
	}

	return me;
}

export function requireScheduler(c: Ctx): void {
	if (!c.scheduledFire) throw new UserError("Not allowed.", { code: "forbidden" });
}

/** For scheduled game steps (turns, drops, starts, VIP tags): false once an admin terminated the table. */
export function scheduledWhileOpen(c: Ctx): boolean {
	requireScheduler(c);

	return !c.vars.terminated;
}

/**
 * For the scheduled `dropIfGone`: a player's last connection closed a while ago and none came back.
 * In the lobby they leave the table; mid-game their seat stays and is played for them at bot speed.
 * Returns false when nothing changed (they came back, or are gone already).
 */
export async function dropIfGone(
	c: Ctx,
	id: unknown,
	turn: { playerId: string | null; key: number },
): Promise<boolean> {
	const game = c.vars.game as Table;
	const player = game.players.find((p) => p.id === id);
	if (!player) return false;

	const cameBack = [...c.conns.values()].some((conn: { id: string }) => playerOf(c, conn) === id);
	if (cameBack) return false;

	if (game.phase === "lobby") {
		c.vars.game = removePlayer(game, player.id);
		return true;
	}

	c.vars.game = markAway(game, player.id);

	// Their turn may be running on the full human clock: play it at bot speed instead.
	if (game.phase === "playing" && turn.playerId === player.id) {
		await c.schedule.after(BOT_THINK_MS[0], "autoPlay", turn.key);
	}

	return true;
}

/** Who was kicked, from which phase, and the match it happened in (null when none was running). */
export type KickResult = {
	playerId: string;
	name: string;
	seat: number;
	phase: Table["phase"];
	matchId: string | null;
};

/**
 * Kicks the human in `seat` off the table and keeps them off it (see kickPlayer for what happens to the chair).
 * The host may only kick before the game starts, and not themselves. The caller commits with `entries`, which
 * log the kick when a match is running, then calls `closeKicked`.
 */
export function kickFromTable(
	c: Ctx,
	seat: number,
	by: { kind: "admin"; reason: string } | { kind: "host"; hostId: string },
): { result: KickResult; entries: LogEntry[] } {
	if (c.vars.terminated) {
		throw new UserError("This table is already closed.", { code: TABLE_CLOSED });
	}

	const game = c.vars.game as Table;
	const target = game.players.find((p) => p.seat === seat);
	if (!target) {
		throw new UserError("Nobody sits in that seat.", { code: "rule" });
	}
	if (target.bot) {
		throw new UserError("That is a bot. Remove it instead.", { code: "rule" });
	}

	if (by.kind === "host") {
		if (game.phase !== "lobby") {
			throw new UserError("Players can only be removed before the game starts.", { code: "rule" });
		}
		if (target.id === by.hostId) {
			throw new UserError("Use Leave table to leave.", { code: "rule" });
		}
	}

	c.vars.kicked = [...(c.vars.kicked as string[]), target.id];
	c.vars.game = kickPlayer(game, target.id);

	const data: Record<string, unknown> = { by: by.kind };
	if (by.kind === "admin") {
		data.reason = by.reason;
	}

	const result: KickResult = {
		playerId: target.id,
		name: target.name,
		seat: target.seat,
		phase: game.phase,
		matchId: (c.vars.match as MatchState | null)?.id ?? null,
	};

	return { result, entries: [{ type: "kicked", seat: target.seat, data }] };
}

/**
 * After a kick is committed: their turn, if it is running, is played at bot speed, and their connections close
 * with the reason. `turn` is the running turn, as for dropIfGone.
 */
export async function closeKicked(
	c: Ctx,
	playerId: string,
	turn: { playerId: string | null; key: number },
): Promise<void> {
	const game = c.vars.game as Table;
	if (game.phase === "playing" && turn.playerId === playerId) {
		await c.schedule.after(BOT_THINK_MS[0], "autoPlay", turn.key);
	}

	closeConnections(c, (conn) => c.vars.who[conn.id]?.id === playerId, KICKED_MESSAGE);
}

/** What the table was doing when an admin terminated it. */
export type TerminateResult = {
	phase: Table["phase"];
	matchId: string | null;
	round: number;
	players: number;
};

/**
 * An admin terminates the table: nothing moves there again and nobody can join. A running match ends as
 * terminated, with `entries` as its last log event; the caller commits with them (which queues its report),
 * then calls `closeTerminated`.
 */
export function terminateTable(
	c: Ctx,
	reason: string,
): { result: TerminateResult; entries: LogEntry[] } {
	if (c.vars.terminated) {
		throw new UserError("This table is already closed.", { code: TABLE_CLOSED });
	}

	const game = c.vars.game as Table & { round?: number };
	const termination: Termination = { at: Date.now(), reason };
	c.vars.terminated = termination;

	const result: TerminateResult = {
		phase: game.phase,
		matchId: (c.vars.match as MatchState | null)?.id ?? null,
		round: game.round ?? 0,
		players: game.players.length,
	};

	return { result, entries: [{ type: "terminated", data: { by: "admin", reason } }] };
}

/**
 * After a termination is committed: every player's connection closes with the reason, and a tournament table
 * that had no match running is closed on the platform (a running match's report closes it instead).
 */
export async function closeTerminated(c: Ctx, result: TerminateResult): Promise<void> {
	closeConnections(c, (conn) => !!c.vars.who[conn.id], TERMINATED_MESSAGE);

	const tournament = c.vars.tournament as TournamentRoom | null | undefined;
	if (!tournament || tournament.closed || result.matchId) {
		return;
	}

	c.vars.tournament = { ...tournament, closed: true };

	const code = c.key[0] as string;
	const marked = await markRoom(code, "close", "terminated");
	if (!marked.ok) {
		c.log.warn({ msg: "room termination not recorded", code, detail: marked.detail });
	}
}

/** Tells each chosen connection why, then closes it. The browser stops reconnecting on TABLE_CLOSED. */
function closeConnections(
	c: Ctx,
	chosen: (conn: { id: string }) => boolean,
	message: string,
): void {
	for (const conn of c.conns.values()) {
		if (!chosen(conn)) {
			continue;
		}

		conn.send("closed", { code: TABLE_CLOSED, message });
		// "<group>.<code>", the shape the Rivet client reads a close reason in.
		conn.disconnect(`user.${TABLE_CLOSED}`);
	}
}

/**
 * Arms the timer for the current turn and schedules `autoPlay(key)` for it: a short think time for bots
 * and away players, the full `turnMs` for humans. Runs on every commit but only arms once per `key`
 * (a number that changes whenever a new turn starts); `resume` re-arms after a wake.
 * `pause` holds the clock for an animation.
 */
export async function armTurn(
	c: Ctx,
	current: { bot: boolean; away?: boolean } | undefined,
	opts: { key: number; turnMs: number; pause: number; resume: boolean; rng: () => number },
): Promise<void> {
	const { timer } = c.vars as RoomVars<Table>;
	if (!current) {
		c.vars.timer = null;
		return;
	}

	const sameTurn = timer?.moves === opts.key;
	if (sameTurn && !opts.resume) return;

	// Resuming after a wake keeps the deadline players already saw.
	const next: NonNullable<TurnTimer> = sameTurn
		? { ...timer!, total: timer!.total ?? opts.turnMs }
		: {
				moves: opts.key,
				endsAt: Date.now() + opts.pause + opts.turnMs,
				total: opts.turnMs,
			};
	c.vars.timer = next;

	const pause = sameTurn ? 0 : opts.pause;
	const untilTimeout = Math.max(0, next.endsAt - Date.now());

	let delay = untilTimeout;
	if (current.bot || current.away) {
		// A bot plays once it has "decided", which stops its clock early, like a quick human.
		const [minThink, maxThink] = BOT_THINK_MS;
		const think = minThink + Math.round(opts.rng() * (maxThink - minThink));
		delay = Math.min(untilTimeout, pause + think);
	}

	await c.schedule.after(delay, "autoPlay", opts.key);
}

/** The turn clock as clients get it: relative, so a wrong device clock still counts down correctly. */
export function turnClock(timer: TurnTimer): { left: number; total: number } | null {
	if (!timer) return null;

	return { left: Math.max(0, timer.endsAt - Date.now()), total: timer.total };
}

/**
 * Keeps this table's line in its game's room list current. A table with nobody connected is
 * taken off the list (bots alone don't count). `leaving` is a connection that is closing.
 * The list is a convenience, so a failure is logged and the game carries on.
 */
export async function reportToDirectory(c: Ctx, slug: string, leaving?: string): Promise<void> {
	// Public tables go to the game's list. Tournament tables go to their own list for the backoffice (round and
	// seats). Private tables are for their players only.
	const tournament = await loadTournament(c).catch(() => undefined);
	const listKey = directoryKey(slug, c.vars.listed === true, !!tournament);
	if (!listKey) return;

	const code = c.key[0] as string;
	const directory = c.client().roomList.getOrCreate([listKey]);
	const game = c.vars.game as Table & { round?: number };
	// Only players count: the backoffice's connection is not someone at the table.
	const stayingConns = [...c.conns.values()].filter(
		(conn: { id: string }) => conn.id !== leaving && c.vars.who[conn.id],
	);

	try {
		if (stayingConns.length === 0 || c.vars.terminated) {
			await directory.remove(code);
			return;
		}

		const host = game.players.find((p) => p.id === game.hostId)?.name ?? null;
		await directory.report({
			code,
			host,
			players: game.players.length,
			maxPlayers: SEATS,
			phase: game.phase,
			seats: game.players.map((p) => ({ seat: p.seat, name: p.name, bot: p.bot })),
			round: game.round ?? 0,
		});
	} catch (err) {
		c.log.warn({ msg: "room list update failed", code, err: String(err) });
	}
}

/** Which room list a table reports to: the public one, the backoffice's tournament one, or none (private). */
export function directoryKey(slug: string, listed: boolean, tournament: boolean): string | null {
	if (listed) return slug;
	if (tournament) return tournamentListKey(slug);

	return null;
}

/** onWake: a send may have been cut off by the actor stopping; the platform ignores duplicates. */
export async function resumeReports(c: Ctx): Promise<void> {
	const [pending] = await c.db.execute("SELECT count(*) AS n FROM match_reports");
	if (pending?.n) await c.schedule.after(REPORT_RETRY_MS[0]!, "sendReports");
}

/** Body of the scheduled `sendReports` action: sends queued results, retrying with backoff. */
export async function sendReports(c: Ctx): Promise<void> {
	type ReportRow = { match_id: string; body: string; attempts: number };
	const rows = (await c.db.execute(
		"SELECT match_id, body, attempts FROM match_reports",
	)) as ReportRow[];

	let retryIn: number | null = null;

	for (const row of rows) {
		const { result, detail } = await reportMatch(JSON.parse(row.body));

		if (result === "retry") {
			await c.db.execute(
				"UPDATE match_reports SET attempts = attempts + 1 WHERE match_id = ?",
				row.match_id,
			);

			const step = Math.min(row.attempts, REPORT_RETRY_MS.length - 1);
			const wait = REPORT_RETRY_MS[step]!;
			retryIn = Math.min(retryIn ?? wait, wait);

			c.log.warn({
				msg: "match report failed, will retry",
				matchId: row.match_id,
				attempts: row.attempts + 1,
				detail,
			});
			continue;
		}

		if (result === "rejected") {
			c.log.error({
				msg: "match report rejected, dropped",
				matchId: row.match_id,
				body: row.body,
				detail,
			});
		}

		await c.db.execute("DELETE FROM match_reports WHERE match_id = ?", row.match_id);
	}

	if (retryIn !== null) await c.schedule.after(retryIn, "sendReports");
}

/** The room's tournament and whether it is listed: the known answer, else asked from the platform. */
export async function loadTournament(c: Ctx): Promise<TournamentRoom | null> {
	const known = c.vars.tournament as TournamentRoom | null | undefined;
	// `listed` is undefined in rooms saved before private tables existed: ask once more.
	if (known !== undefined && c.vars.listed !== undefined) return known;

	return refreshTournament(c);
}

/**
 * Asks the platform again for the room's tournament and whether it is listed (on every wake, to see a cancel).
 * If the platform can't be reached, the last known answer stands; with none yet, joining is refused.
 */
export async function refreshTournament(c: Ctx): Promise<TournamentRoom | null> {
	const known = c.vars.tournament as TournamentRoom | null | undefined;
	const code = c.key[0] as string;
	let room: Awaited<ReturnType<typeof fetchRoomSeats>>;
	try {
		room = await fetchRoomSeats(code);
	} catch (err) {
		c.log.warn({ msg: "room seats unavailable", code, err: String(err) });
		if (known !== undefined) return known;

		throw new UserError("The table can't be reached right now. Try again shortly.", {
			code: "unavailable",
		});
	}
	const tournament = room?.tournament;
	c.vars.listed = !tournament && room?.visibility === "public";

	if (!tournament) {
		c.vars.tournament = null;
		return null;
	}

	const seats = Object.fromEntries(room!.seats.map((seat) => [seat.playerId, seat.seat]));
	c.vars.tournament = {
		name: tournament.name,
		startsAt: Date.parse(tournament.startsAt),
		cancelled: tournament.cancelled,
		minPlayers: room!.minPlayers,
		seats,
		closed: !!known?.closed || !!room!.closedAt,
	};

	return c.vars.tournament;
}

/** onWake: refreshes the tournament and arms its start and the end of the wait for late players. */
export async function wakeTournament(c: Ctx): Promise<void> {
	const tournament = await refreshTournament(c).catch(() => null);
	if (!tournament || tournament.closed || tournament.cancelled) return;
	if ((c.vars.game as Table).phase !== "lobby") return;

	const now = Date.now();
	if (tournament.startsAt > now) {
		await c.schedule.at(tournament.startsAt, "tournamentStart");
	}

	const waitEndsAt = Math.max(now, tournament.startsAt + LATE_GRACE_MS);
	await c.schedule.at(waitEndsAt, "tournamentStart");
}

/**
 * The seat a joining player must take (undefined = any free one). Throws if they may not sit here.
 * Asks the platform again first, since an admin may have seated or removed someone by hand.
 */
export async function seatFor(c: Ctx, who: Identity): Promise<number | undefined> {
	const tournament = c.vars.tournament === null ? null : await refreshTournament(c);
	if (!tournament) return undefined;

	if (tournament.cancelled) {
		throw new UserError(`${tournament.name} was cancelled.`, { code: "forbidden" });
	}
	if (tournament.closed) {
		throw new UserError("This table has finished.", { code: "forbidden" });
	}
	if (!(who.id in tournament.seats)) {
		throw new UserError(`This table is for players of ${tournament.name}.`, { code: "forbidden" });
	}

	return tournament.seats[who.id] ?? undefined;
}

/** Host controls (bots, seats, start, play again) are for open tables; a tournament table runs itself. */
export function requireOpenTable(c: Ctx): void {
	if (c.vars.tournament) {
		throw new UserError("A tournament table starts on its own.", { code: "rule" });
	}
}

/**
 * Starts a tournament room's match: at the start time once every assigned player sits, otherwise when
 * the wait for late players ends, with whoever came. Fewer than the game's minimum then closes the table.
 * Runs when scheduled and after each join; does nothing before the start time or once the match began.
 */
export async function tournamentTick(
	c: Ctx,
	game: { start: () => void; commit: () => Promise<void> },
): Promise<void> {
	const tournament = c.vars.tournament as TournamentRoom | null | undefined;
	const table = c.vars.game as Table;
	const now = Date.now();

	if (!tournament || tournament.closed || tournament.cancelled) return;
	if (c.vars.terminated) {
		return;
	}
	if (table.phase !== "lobby" || now < tournament.startsAt) return;

	// Since they sat down a player may have withdrawn, been disqualified or moved by an admin: ask again, and
	// whoever has no seat here anymore leaves before the match starts.
	const seated = (await refreshTournament(c).catch(() => null)) ?? tournament;
	if (seated.cancelled) return;

	const unseated = table.players.filter((player) => !player.bot && !(player.id in seated.seats));
	for (const player of unseated) {
		c.vars.game = removePlayer(c.vars.game as Table, player.id);
	}

	const present = (c.vars.game as Table).players.filter((player) => !player.bot).length;
	const everyoneIsHere = present >= Object.keys(seated.seats).length;
	const stillWaiting = now < seated.startsAt + LATE_GRACE_MS;
	if (!everyoneIsHere && stillWaiting) {
		if (unseated.length > 0) await game.commit();
		return;
	}

	const code = c.key[0] as string;

	if (present >= seated.minPlayers) {
		game.start();
		await game.commit();

		const marked = await markRoom(code, "start");
		if (!marked.ok) {
			c.log.warn({ msg: "room start not recorded", code, detail: marked.detail });
		}
		return;
	}

	c.vars.tournament = { ...seated, closed: true };
	await game.commit();

	const marked = await markRoom(code, "close");
	if (!marked.ok) {
		c.log.warn({ msg: "room close not recorded", code, detail: marked.detail });
	}
}

/** The tournament part of the view. Times are relative, like the turn clock, so a wrong device clock still counts right. */
export function tournamentView(c: Ctx) {
	const tournament = c.vars.tournament as TournamentRoom | null | undefined;
	if (!tournament) return null;

	const now = Date.now();
	return {
		name: tournament.name,
		startsIn: tournament.startsAt - now,
		waitEndsIn: tournament.startsAt + LATE_GRACE_MS - now,
		seats: Object.keys(tournament.seats).length,
		closed: tournament.closed,
	};
}

/**
 * Starts the room's VIP check if none is running. Its due time is not saved: after a wake the next
 * connection starts a fresh check, and the timer left from before the sleep is ignored.
 */
export async function armVipRefresh(c: Ctx): Promise<void> {
	if (c.vars.vipCheckAt) return;

	const at = Date.now() + VIP_REFRESH_MS;
	c.vars.vipCheckAt = at;
	await c.schedule.at(at, "refreshVips", at);
}

/**
 * For the scheduled `refreshVips`: shows a VIP grant or revoke on seated humans' tags, and keeps
 * checking while anyone is connected. Returns true when a tag changed.
 */
export async function refreshVips(c: Ctx, at: unknown): Promise<boolean> {
	// A timer from before a sleep, or a duplicate.
	if (at !== c.vars.vipCheckAt) return false;

	c.vars.vipCheckAt = null;
	if (c.conns.size > 0) {
		await armVipRefresh(c);
	}

	const humanIds = (c.vars.game as Table).players
		.filter((player) => !player.bot)
		.map((player) => player.id);
	if (humanIds.length === 0) return false;

	let vipIds: Set<string>;
	try {
		vipIds = await fetchVipIds(humanIds);
	} catch (err) {
		c.log.warn({ msg: "vip check failed", err: String(err) });
		return false;
	}

	// Read the game again: a move may have landed while the platform answered.
	const game = c.vars.game as Table;
	const updated = showVips(game, vipIds);
	if (updated === game) return false;

	c.vars.game = updated;
	return true;
}
