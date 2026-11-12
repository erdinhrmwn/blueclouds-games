import type { SQL } from "bun";
import { z } from "zod";
import { ApiError } from "../lib/http";
import { closeRoom } from "./tournaments";

const Seat = z
	.object({
		seat: z.number().int().min(0).max(31),
		playerId: z.uuid().nullable(),
		bot: z.boolean(),
		botName: z.string().trim().min(1).max(20).optional(),
		placement: z.number().int().min(1).max(32),
		/** Game-defined final number (Bust 31: lives left, Cloudburst: points); its label is in `games`. */
		score: z.number().int().min(-1_000_000).max(1_000_000),
	})
	.refine((s) => s.bot === (s.playerId === null) && s.bot === (s.botName !== undefined), {
		message: "A seat is either a player (playerId) or a bot (botName).",
	});

/** Limits of a match's move log. The request body limit for reports is in app.ts. */
export const MAX_LOG_EVENTS = 5_000;
const MAX_EVENT_DATA_BYTES = 4 * 1024;

/** The envelope every game's log event shares; `data` is the game's own and stored as is. */
const LogEvent = z.object({
	seq: z.number().int().min(0),
	t: z.number().int().min(0),
	type: z.string().regex(/^[a-z_]{1,32}$/),
	seat: z.number().int().min(0).max(31).optional(),
	data: z
		.record(z.string(), z.unknown())
		.refine(
			(d) => JSON.stringify(d).length <= MAX_EVENT_DATA_BYTES,
			`Must be at most ${MAX_EVENT_DATA_BYTES} bytes.`,
		)
		.optional(),
});

const MatchLog = z.object({
	logVersion: z.number().int().min(1),
	events: z.array(LogEvent).min(1).max(MAX_LOG_EVENTS),
});

/** A finished match as a room reports it. Lives here, not in the route, because the stored hash is built from it. */
export const MatchReport = z
	.object({
		matchId: z.uuidv7(),
		game: z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game."),
		roomCode: z.string().regex(/^[A-Z0-9]{4,8}$/),
		rulesVersion: z.number().int().min(1),
		startedAt: z.iso.datetime({ offset: true }),
		endedAt: z.iso.datetime({ offset: true }),
		players: z.array(Seat).min(1).max(32),
		log: MatchLog,
	})
	.superRefine((m, ctx) => {
		const issue = (message: string, path: string) =>
			ctx.addIssue({ code: "custom", message, path: [path] });
		if (new Set(m.players.map((p) => p.seat)).size !== m.players.length)
			issue("Seats must be unique.", "players");
		const ids = m.players.flatMap((p) => (p.playerId ? [p.playerId] : []));
		if (new Set(ids).size !== ids.length) issue("A player can only sit once.", "players");
		if (m.players.filter((p) => p.placement === 1).length !== 1)
			issue("Exactly one player must place first.", "players");
		if (Date.parse(m.endedAt) < Date.parse(m.startedAt))
			issue("Must not be before startedAt.", "endedAt");
		const seats = new Set(m.players.map((p) => p.seat));
		const bad = m.log.events.findIndex(
			(e, i) => e.seq !== i || (e.seat !== undefined && !seats.has(e.seat)),
		);
		if (bad >= 0) issue(`Event ${bad} must have seq ${bad} and a seat from players.`, "log");
	});
export type MatchReport = z.output<typeof MatchReport>;

/** Same report → same hash. Built from the parsed report, so key order and seat order are fixed. */
function hashReport(m: MatchReport): Buffer {
	const canonical = { ...m, players: [...m.players].sort((a, b) => a.seat - b.seat) };
	return new Bun.CryptoHasher("sha256").update(JSON.stringify(canonical)).digest();
}

const HISTORY_PAGE = 20;

/**
 * Stores a reported match with its move log. Idempotent by matchId: a retry with the same body returns
 * false (already stored); the same id with a different body is a conflict.
 */
export async function recordMatch(sql: SQL, m: MatchReport): Promise<boolean> {
	// The game catalog lives in the database: a new game only adds its row to `games`.
	const [game] = await sql`SELECT min_players, max_players FROM games WHERE slug = ${m.game}`;
	if (!game)
		throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
	if (m.players.length < game.min_players || m.players.length > game.max_players) {
		throw new ApiError("bad_input", 400, "Some fields are invalid.", {
			players: `Needs ${game.min_players}–${game.max_players} players.`,
		});
	}
	const hash = hashReport(m);
	return sql.begin(async (tx) => {
		// A retry of a stored match is answered from the stored hash, before anything else is looked up.
		const stored = async () =>
			(await tx`SELECT body_hash FROM matches WHERE id = ${m.matchId}`)[0]?.body_hash as
				Uint8Array | undefined;
		const retry = (existing: Uint8Array) => {
			if (!Buffer.from(existing).equals(hash))
				throw new ApiError(
					"conflict",
					409,
					"This match was already reported with different results.",
				);
			return false;
		};
		const before = await stored();
		if (before) return retry(before);
		const [room] =
			await tx`SELECT id, tournament_id FROM rooms WHERE code = ${m.roomCode} AND game_slug = ${m.game}`;
		if (!room)
			throw new ApiError("unknown_room", 422, "The match names a room that does not exist.");
		const inserted = await tx`
			INSERT INTO matches (id, game_slug, room_id, rules_version, started_at, ended_at, body_hash)
			VALUES (${m.matchId}, ${m.game}, ${room.id}, ${m.rulesVersion}, ${m.startedAt}, ${m.endedAt}, ${hash})
			ON CONFLICT (id) DO NOTHING RETURNING id`;
		if (inserted.length === 0) return retry((await stored())!); // a concurrent retry got there first
		const ids = m.players.flatMap((p) => (p.playerId ? [p.playerId] : []));
		if (ids.length) {
			const [{ n }] = await tx`SELECT count(*)::int AS n FROM players WHERE id IN ${tx(ids)}`;
			if (n !== ids.length)
				throw new ApiError("unknown_player", 422, "The match lists a player that does not exist.");
		}
		const rows = m.players.map((p) => ({
			match_id: m.matchId,
			seat: p.seat,
			player_id: p.playerId,
			bot_name: p.botName ?? null,
			placement: p.placement,
			score: p.score,
		}));
		await tx`INSERT INTO match_players ${tx(rows)}`;
		// A tournament room plays one match: its report closes the room (and the tournament, if it was the last).
		if (room.tournament_id) await closeRoom(tx, room.id, "finished", m.startedAt);
		await tx`
			INSERT INTO match_logs (match_id, log_version, event_count, events)
			VALUES (${m.matchId}, ${m.log.logVersion}, ${m.log.events.length}, ${JSON.stringify(m.log.events)}::text::jsonb)`;
		return true;
	});
}

/** The player's own history, newest first. Cursor = last match id of the previous page. */
export async function history(sql: SQL, playerId: string, cursor: string | undefined) {
	const rows = await sql`
		SELECT m.id, m.game_slug, r.code AS room_code, m.started_at, m.ended_at, mp.seat, mp.placement, mp.score,
		       (SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS players
		FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN rooms r ON r.id = m.room_id
		WHERE mp.player_id = ${playerId} ${cursor ? sql`AND mp.match_id < ${cursor}` : sql``}
		ORDER BY mp.match_id DESC
		LIMIT ${HISTORY_PAGE + 1}`;
	const page = rows.slice(0, HISTORY_PAGE);
	return {
		matches: page.map((r: any) => ({
			id: r.id,
			game: r.game_slug,
			roomCode: r.room_code,
			startedAt: r.started_at.toISOString(),
			endedAt: r.ended_at.toISOString(),
			players: r.players,
			seat: r.seat,
			placement: r.placement,
			score: r.score,
		})),
		nextCursor: rows.length > HISTORY_PAGE ? (page.at(-1)?.id ?? null) : null,
	};
}
