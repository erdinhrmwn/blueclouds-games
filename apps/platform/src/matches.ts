import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { playerAuth, type PlayerVariables, serverAuth } from "./auth";
import { GAMES } from "./games";
import { ApiError, ok, parse, readJson } from "./http";

const Seat = z
	.object({
		seat: z.number().int().min(0).max(31),
		playerId: z.uuid().nullable(),
		bot: z.boolean(),
		botName: z.string().trim().min(1).max(20).optional(),
		placement: z.number().int().min(1).max(32),
		livesLeft: z.number().int().min(0).max(99),
	})
	.refine((s) => s.bot === (s.playerId === null), { message: "A seat has a playerId exactly when it is not a bot." });

const MatchReport = z
	.object({
		matchId: z.uuidv7(),
		game: z.string().refine((g) => GAMES.has(g), "Unknown game."),
		roomCode: z.string().regex(/^[A-Z0-9]{4,8}$/),
		rulesVersion: z.number().int().min(1),
		startedAt: z.iso.datetime({ offset: true }),
		endedAt: z.iso.datetime({ offset: true }),
		players: z.array(Seat).min(1).max(32),
	})
	.superRefine((m, ctx) => {
		const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
		const limits = GAMES.get(m.game);
		if (limits && (m.players.length < limits.minPlayers || m.players.length > limits.maxPlayers)) {
			issue(`Needs ${limits.minPlayers}–${limits.maxPlayers} players.`, "players");
		}
		if (new Set(m.players.map((p) => p.seat)).size !== m.players.length) issue("Seats must be unique.", "players");
		const ids = m.players.flatMap((p) => (p.playerId ? [p.playerId] : []));
		if (new Set(ids).size !== ids.length) issue("A player can only sit once.", "players");
		if (m.players.filter((p) => p.placement === 1).length !== 1) issue("Exactly one player must place first.", "players");
		if (Date.parse(m.endedAt) < Date.parse(m.startedAt)) issue("Must not be before startedAt.", "endedAt");
	});
type MatchReport = z.output<typeof MatchReport>;

/** Same report → same hash. Built from the parsed report, so key order and seat order are fixed. */
function hashReport(m: MatchReport): Buffer {
	const canonical = { ...m, players: [...m.players].sort((a, b) => a.seat - b.seat) };
	return new Bun.CryptoHasher("sha256").update(JSON.stringify(canonical)).digest();
}

const HistoryQuery = z.object({ cursor: z.uuid().optional() });
const HISTORY_PAGE = 20;

export function matchRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<{ Variables: PlayerVariables }>();

	/**
	 * A room reports a finished game. Idempotent by matchId: a retry with the same body returns
	 * the stored match (created: false); the same id with a different body is a conflict.
	 */
	app.post("/matches", serverAuth(serverKey), async (c) => {
		const m = parse(MatchReport, await readJson(c));
		const hash = hashReport(m);
		const created = await sql.begin(async (tx) => {
			const inserted = await tx`
				INSERT INTO matches (id, game_slug, room_code, rules_version, started_at, ended_at, body_hash)
				VALUES (${m.matchId}, ${m.game}, ${m.roomCode}, ${m.rulesVersion}, ${m.startedAt}, ${m.endedAt}, ${hash})
				ON CONFLICT (id) DO NOTHING RETURNING id`;
			if (inserted.length === 0) {
				const [existing] = await tx`SELECT body_hash FROM matches WHERE id = ${m.matchId}`;
				if (!Buffer.from(existing.body_hash).equals(hash)) {
					throw new ApiError("conflict", 409, "This match was already reported with different results.");
				}
				return false;
			}
			const ids = m.players.flatMap((p) => (p.playerId ? [p.playerId] : []));
			if (ids.length) {
				const [{ n }] = await tx`SELECT count(*)::int AS n FROM players WHERE id IN ${tx(ids)}`;
				if (n !== ids.length) throw new ApiError("unknown_player", 422, "The match lists a player that does not exist.");
			}
			const rows = m.players.map((p) => ({
				match_id: m.matchId,
				seat: p.seat,
				player_id: p.playerId,
				bot_name: p.bot ? (p.botName ?? null) : null,
				placement: p.placement,
				lives_left: p.livesLeft,
			}));
			await tx`INSERT INTO match_players ${tx(rows)}`;
			return true;
		});
		return ok(c, { match: { id: m.matchId, created } }, created ? 201 : 200);
	});

	/** The signed-in player's own history, newest first. Cursor = last match id of the previous page. */
	app.get("/players/me/matches", playerAuth(sql), async (c) => {
		const { cursor } = parse(HistoryQuery, c.req.query());
		const me = c.get("player").id;
		const rows = await sql`
			SELECT m.id, m.game_slug, m.room_code, m.started_at, m.ended_at, mp.seat, mp.placement, mp.lives_left,
			       (SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS players
			FROM match_players mp JOIN matches m ON m.id = mp.match_id
			WHERE mp.player_id = ${me} ${cursor ? sql`AND mp.match_id < ${cursor}` : sql``}
			ORDER BY mp.match_id DESC
			LIMIT ${HISTORY_PAGE + 1}`;
		const page = rows.slice(0, HISTORY_PAGE);
		return ok(c, {
			matches: page.map((r: any) => ({
				id: r.id,
				game: r.game_slug,
				roomCode: r.room_code,
				startedAt: r.started_at.toISOString(),
				endedAt: r.ended_at.toISOString(),
				players: r.players,
				seat: r.seat,
				placement: r.placement,
				livesLeft: r.lives_left,
			})),
			nextCursor: rows.length > HISTORY_PAGE ? (page.at(-1)?.id ?? null) : null,
		});
	});

	return app;
}
