// Actor-side helpers every game room shares: who is connected, the turn clock, leaving,
// the room list and the match result outbox. Each game keeps its own actor and actions.
import { UserError } from "rivetkit";
import { type Identity, reportMatch, verifyPlayToken } from "../../platform";
import { ConnParams, SeatInput } from "./schema";
import { removePlayer, RuleError, SEATS, setAway, type Table } from "./table";

/** How long a closed tab has to come back (a refresh) before its player leaves the table. */
export const GONE_AFTER_MS = 15_000;
/** A bot gets the same turn clock as a human; it just decides within this range (random). */
export const BOT_THINK_MS = [1500, 4000] as const;
const BOT_NAMES = ["Bot Cloud", "Bot Rain", "Bot Thunder", "Bot Rainbow", "Bot Wind"];
/** Wait before each retry of an unsent match result; the last one repeats forever. */
const REPORT_RETRY_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000];

/** The turn the timer belongs to (`moves` = the turn key), when it runs out (epoch ms), and its full length. */
export type TurnTimer = { moves: number; endsAt: number; total: number } | null;

/** What every room keeps in `c.vars` besides its game-specific fields. */
export type RoomVars<G extends Table> = { game: G; timer: TurnTimer; who: Record<string, Identity> };

// ponytail: helpers take `any` because rivetkit's context generics are long;
// they only touch c.vars, c.conn, c.db, c.conns, c.key, c.log, c.client() and c.schedule.
export type Ctx = any;

/** Outbox: finished match results waiting to reach the platform. Each room creates it in onMigrate. */
export const REPORTS_TABLE =
	"CREATE TABLE IF NOT EXISTS match_reports (match_id TEXT PRIMARY KEY, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)";

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
	if (!parsed.success) throw new UserError("That seat does not exist.", { code: "bad_input" });
	return parsed.data;
}

export function botName(players: { name: string }[]): string {
	const used = new Set(players.map((p) => p.name));
	return BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${players.length + 1}`;
}

/** onBeforeConnect: only connections with a valid play token get in. */
export async function checkConnect(params: unknown): Promise<void> {
	const parsed = ConnParams.safeParse(params);
	if (!parsed.success || !(await verifyPlayToken(parsed.data.playToken))) {
		throw new UserError("Your session expired. Reload the page.", { code: "unauthenticated" });
	}
}

/** onConnect: remembers who the connection is. Checked again because onBeforeConnect can't hand its result over. */
export async function identify(c: Ctx, conn: { id: string; params: unknown; disconnect: (reason: string) => void }): Promise<boolean> {
	const who = await verifyPlayToken(ConnParams.parse(conn.params).playToken);
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
	if (!who) throw new UserError("Your session expired. Reload the page.", { code: "unauthenticated" });
	return who;
}

/** The player a connection sits as, if they joined the table. */
export function playerOf(c: Ctx, conn: { id: string }): string | undefined {
	const id = (c.vars.who[conn.id] as Identity | undefined)?.id;
	return id && (c.vars.game as Table).players.some((p) => p.id === id) ? id : undefined;
}

export function requirePlayer(c: Ctx): string {
	const id = playerOf(c, c.conn);
	if (!id) throw new UserError("Join the table first.", { code: "not_joined" });
	return id;
}

export function requireHost(c: Ctx): string {
	const me = requirePlayer(c);
	if ((c.vars.game as Table).hostId !== me) throw new UserError("Only the host can do that.", { code: "rule" });
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
export async function dropIfGone(c: Ctx, id: unknown, turn: { playerId: string | null; key: number }): Promise<boolean> {
	const game = c.vars.game as Table;
	const player = game.players.find((p) => p.id === id);
	if (!player || [...c.conns.values()].some((conn: { id: string }) => playerOf(c, conn) === id)) return false;
	if (game.phase === "lobby") {
		c.vars.game = removePlayer(game, player.id);
	} else {
		c.vars.game = setAway(game, player.id, true);
		// Their turn may be running on the full human clock: play it at bot speed instead.
		if (game.phase === "playing" && turn.playerId === player.id) await c.schedule.after(BOT_THINK_MS[0], "autoPlay", turn.key);
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
	const same = timer?.moves === opts.key;
	if (same && !opts.resume) return;
	// Resuming after a wake keeps the deadline players already saw.
	const next: NonNullable<TurnTimer> = same ? { ...timer!, total: timer!.total ?? opts.turnMs } : { moves: opts.key, endsAt: Date.now() + opts.pause + opts.turnMs, total: opts.turnMs };
	c.vars.timer = next;
	const pause = same ? 0 : opts.pause;
	const untilTimeout = Math.max(0, next.endsAt - Date.now());
	const [min, max] = BOT_THINK_MS;
	// A bot plays once it has "decided", which stops its clock early, like a quick human.
	const delay = current.bot || current.away ? Math.min(untilTimeout, pause + min + Math.round(opts.rng() * (max - min))) : untilTimeout;
	await c.schedule.after(delay, "autoPlay", opts.key);
}

/** The turn clock as clients get it: relative, so a wrong device clock still counts down correctly. */
export function turnClock(timer: TurnTimer): { left: number; total: number } | null {
	return timer && { left: Math.max(0, timer.endsAt - Date.now()), total: timer.total };
}

/**
 * Keeps this table's line in its game's room list current. A table with nobody connected is
 * taken off the list (bots alone don't count). `leaving` is a connection that is closing.
 * The list is a convenience, so a failure is logged and the game carries on.
 */
export async function reportToDirectory(c: Ctx, slug: string, leaving?: string): Promise<void> {
	const code = c.key[0] as string;
	const directory = c.client().roomList.getOrCreate([slug]);
	const connected = [...c.conns.values()].filter((conn: { id: string }) => conn.id !== leaving).length;
	const game = c.vars.game as Table;
	try {
		if (connected === 0) {
			await directory.remove(code);
			return;
		}
		const host = game.players.find((p) => p.id === game.hostId)?.name ?? null;
		await directory.report({ code, host, players: game.players.length, maxPlayers: SEATS, phase: game.phase });
	} catch (err) {
		c.log.warn({ msg: "room list update failed", code, err: String(err) });
	}
}

/** Puts a finished match's result in the outbox; call `c.schedule.after(0, "sendReports")` after the commit. */
export async function queueReport(c: Ctx, report: { matchId: string }): Promise<void> {
	await c.db.execute("INSERT OR IGNORE INTO match_reports (match_id, body) VALUES (?, ?)", report.matchId, JSON.stringify(report));
}

/** onWake: a send may have been cut off by the actor stopping; the platform ignores duplicates. */
export async function resumeReports(c: Ctx): Promise<void> {
	const [pending] = await c.db.execute("SELECT count(*) AS n FROM match_reports");
	if (pending?.n) await c.schedule.after(REPORT_RETRY_MS[0]!, "sendReports");
}

/** Body of the scheduled `sendReports` action: sends queued results, retrying with backoff. */
export async function sendReports(c: Ctx): Promise<void> {
	const rows = (await c.db.execute("SELECT match_id, body, attempts FROM match_reports")) as { match_id: string; body: string; attempts: number }[];
	let retryIn: number | null = null;
	for (const row of rows) {
		const { result, detail } = await reportMatch(JSON.parse(row.body));
		if (result === "retry") {
			await c.db.execute("UPDATE match_reports SET attempts = attempts + 1 WHERE match_id = ?", row.match_id);
			const wait = REPORT_RETRY_MS[Math.min(row.attempts, REPORT_RETRY_MS.length - 1)]!;
			retryIn = Math.min(retryIn ?? wait, wait);
			c.log.warn({ msg: "match report failed, will retry", matchId: row.match_id, attempts: row.attempts + 1, detail });
			continue;
		}
		if (result === "rejected") c.log.error({ msg: "match report rejected, dropped", matchId: row.match_id, body: row.body, detail });
		await c.db.execute("DELETE FROM match_reports WHERE match_id = ?", row.match_id);
	}
	if (retryIn !== null) await c.schedule.after(retryIn, "sendReports");
}

/** Sends the public view to everyone and each private hand to its owner. */
export function broadcast(c: Ctx, view: unknown, handOf: (playerId: string) => unknown): void {
	c.broadcast("view", view);
	for (const conn of c.conns.values()) {
		const id = playerOf(c, conn);
		if (id) conn.send("hand", handOf(id));
	}
}
