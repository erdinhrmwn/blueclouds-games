// Actor-side helpers every game room shares: who is connected, the turn clock, leaving,
// the room list and the match result outbox. Each game keeps its own actor and actions.
import { UserError } from "rivetkit";
import {
	fetchRoomSeats,
	fetchVipIds,
	type Identity,
	markRoom,
	reportMatch,
	verifyPlayToken,
} from "../../platform";
import { type LogEntry, type LogEvent, type MatchReport, type MatchState, stamp } from "./match";
import { ConnParams, SeatInput } from "./schema";
import { markAway, removePlayer, RuleError, SEATS, showVips, type Table } from "./table";

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

/**
 * What a room saves: the game, its turn timer, the match being played (null in the lobby), its
 * tournament (null = an open room, undefined = not asked yet), and whether it is in the room list (public).
 */
export type Saved<G extends Table, M extends MatchState = MatchState> = {
	game: G;
	timer: TurnTimer;
	match: M | null;
	tournament?: TournamentRoom | null;
	listed?: boolean;
};

/**
 * What every room keeps in `c.vars`. Not saved: who each open connection is (connections close when
 * the actor sleeps), the game as last committed, to see what each commit changed for the move log,
 * and when the running VIP check is due (null = none running).
 */
export type RoomVars<G extends Table, M extends MatchState = MatchState> = Saved<G, M> & {
	who: Record<string, Identity>;
	logged: G;
	vipCheckAt: number | null;
};

export const roomVars = <G extends Table, M extends MatchState>(game: G): RoomVars<G, M> => ({
	game,
	logged: game,
	who: {},
	vipCheckAt: null,
	timer: null,
	match: null,
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

	// Matches started before the move log have no seq yet.
	if (c.vars.match) c.vars.match.seq ??= 0;

	c.vars.logged = c.vars.game;
}

/**
 * After every change: arm the turn clock (`scheduleTurn`), log what changed, save room + log in one
 * transaction (so the log never skips or repeats a move), then push the view to everyone and each
 * hand to its owner. When the game just finished, its result and full log go to the outbox.
 * `auto` marks a move the server made (bot, timeout or away player) for the move log.
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
		) => MatchReport;
		view: () => unknown;
		handOf: (playerId: string) => unknown;
	},
	auto = false,
): Promise<void> {
	await game.scheduleTurn();

	const vars = c.vars as RoomVars<G, M>;
	const entries = vars.match ? game.logEvents(vars.logged, vars.game, auto) : [];
	vars.logged = vars.game;

	let match = vars.match;
	let events: LogEvent[] = [];
	if (match) {
		const noted = game.noteMove ? game.noteMove(match, vars.game) : match;
		({ match, events } = stamp(noted, entries, Date.now()));
	}

	const finished = !!match && vars.game.phase === "finished";
	vars.match = finished ? null : match;

	const saved: Saved<G, M> = {
		game: vars.game,
		timer: vars.timer,
		match: vars.match,
		tournament: vars.tournament,
		listed: vars.listed,
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
				const log = rows.map((row: { body: string }) => JSON.parse(row.body) as LogEvent);
				const roomCode = c.key[0] as string;
				const endedAt = new Date().toISOString();
				const report = game.buildReport(match!, vars.game, roomCode, endedAt, log);

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

/** onBeforeConnect: only connections with a valid play token get in. */
export async function checkConnect(params: unknown): Promise<void> {
	const parsed = ConnParams.safeParse(params);
	const identity = parsed.success ? await verifyPlayToken(parsed.data.playToken) : null;

	if (!identity) {
		throw new UserError("Your session expired. Reload the page.", { code: "unauthenticated" });
	}
}

/** onConnect: remembers who the connection is. Checked again because onBeforeConnect can't hand its result over. */
export async function identify(
	c: Ctx,
	conn: { id: string; params: unknown; disconnect: (reason: string) => void },
): Promise<boolean> {
	const { playToken } = ConnParams.parse(conn.params);
	const who = await verifyPlayToken(playToken);
	if (!who) {
		conn.disconnect("unauthenticated");
		return false;
	}

	c.vars.who[conn.id] = who;
	return true;
}

/** The identity of the connection calling an action. */
export function caller(c: Ctx): Identity {
	const who = c.vars.who[c.conn.id] as Identity | undefined;
	if (!who) {
		throw new UserError("Your session expired. Reload the page.", { code: "unauthenticated" });
	}

	return who;
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
	// Only rooms known to be public are listed: private and tournament tables are for their players only.
	await loadTournament(c).catch(() => undefined);
	if (!c.vars.listed) return;

	const code = c.key[0] as string;
	const directory = c.client().roomList.getOrCreate([slug]);
	const game = c.vars.game as Table;
	const stayingConns = [...c.conns.values()].filter((conn: { id: string }) => conn.id !== leaving);

	try {
		if (stayingConns.length === 0) {
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
		});
	} catch (err) {
		c.log.warn({ msg: "room list update failed", code, err: String(err) });
	}
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
	if (table.phase !== "lobby" || now < tournament.startsAt) return;

	const present = table.players.filter((player) => !player.bot).length;
	const everyoneIsHere = present >= Object.keys(tournament.seats).length;
	const stillWaiting = now < tournament.startsAt + LATE_GRACE_MS;
	if (!everyoneIsHere && stillWaiting) return;

	const code = c.key[0] as string;

	if (present >= tournament.minPlayers) {
		game.start();
		await game.commit();

		const marked = await markRoom(code, "start");
		if (!marked.ok) {
			c.log.warn({ msg: "room start not recorded", code, detail: marked.detail });
		}
		return;
	}

	c.vars.tournament = { ...tournament, closed: true };
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
