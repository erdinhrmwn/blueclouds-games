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
	.refine(
		(seat) => seat.bot === (seat.playerId === null) && seat.bot === (seat.botName !== undefined),
		{
			message: "A seat is either a player (playerId) or a bot (botName).",
		},
	);

/** Limits of a match's move log. The request body limit for reports is in app.ts. */
export const MAX_LOG_EVENTS = 5_000;
const MAX_EVENT_DATA_BYTES = 4 * 1024;

/** The envelope every game's log event shares; `data` is the game's own and stored as is. */
export const LogEvent = z.object({
	seq: z.number().int().min(0),
	t: z.number().int().min(0),
	type: z.string().regex(/^[a-z_]{1,32}$/),
	seat: z.number().int().min(0).max(31).optional(),
	data: z
		.record(z.string(), z.unknown())
		.refine(
			(data) => JSON.stringify(data).length <= MAX_EVENT_DATA_BYTES,
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
		/** terminated: an admin stopped it; placed by the standings then, and it counts no win. */
		endReason: z.enum(["finished", "terminated"]).default("finished"),
		players: z.array(Seat).min(1).max(32),
		log: MatchLog,
	})
	.superRefine((match, ctx) => {
		const issue = (message: string, path: string) => {
			ctx.addIssue({ code: "custom", message, path: [path] });
		};

		const seats = new Set(match.players.map((player) => player.seat));
		if (seats.size !== match.players.length) {
			issue("Seats must be unique.", "players");
		}

		const playerIds = humanPlayerIds(match.players);
		if (new Set(playerIds).size !== playerIds.length) {
			issue("A player can only sit once.", "players");
		}

		const winners = match.players.filter((player) => player.placement === 1);
		if (winners.length !== 1) {
			issue("Exactly one player must place first.", "players");
		}

		if (Date.parse(match.endedAt) < Date.parse(match.startedAt)) {
			issue("Must not be before startedAt.", "endedAt");
		}

		const badEvent = match.log.events.findIndex((event, index) => {
			const outOfOrder = event.seq !== index;
			const unknownSeat = event.seat !== undefined && !seats.has(event.seat);
			return outOfOrder || unknownSeat;
		});
		if (badEvent >= 0) {
			issue(`Event ${badEvent} must have seq ${badEvent} and a seat from players.`, "log");
		}
	});
export type MatchReport = z.output<typeof MatchReport>;

const HISTORY_PAGE = 20;

/** The ids of the seats a person (not a bot) sat in. */
function humanPlayerIds(players: { playerId: string | null }[]): string[] {
	return players.flatMap((player) => (player.playerId ? [player.playerId] : []));
}

/**
 * Same report → same hash. Built from the parsed report, so key order and seat order are fixed. A finished match
 * hashes without its endReason, as reports did before it existed, so their retries still match.
 */
function hashReport(match: MatchReport): Buffer {
	const players = [...match.players].sort((a, b) => a.seat - b.seat);
	const { endReason, ...withoutEnd } = match;
	const canonical = endReason === "finished" ? { ...withoutEnd, players } : { ...match, players };

	return new Bun.CryptoHasher("sha256").update(JSON.stringify(canonical)).digest();
}

/**
 * Stores a reported match with its move log. Idempotent by matchId: a retry with the same body returns
 * false (already stored); the same id with a different body is a conflict.
 */
export async function recordMatch(sql: SQL, match: MatchReport): Promise<boolean> {
	// The game catalog lives in the database: a new game only adds its row to `games`.
	const [game] = await sql`SELECT min_players, max_players FROM games WHERE slug = ${match.game}`;
	if (!game) {
		throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
	}

	const playerCount = match.players.length;
	if (playerCount < game.min_players || playerCount > game.max_players) {
		throw new ApiError("bad_input", 400, "Some fields are invalid.", {
			players: `Needs ${game.min_players}–${game.max_players} players.`,
		});
	}

	const hash = hashReport(match);

	return sql.begin(async (tx) => {
		const storedHash = async () => {
			const [row] = await tx`SELECT body_hash FROM matches WHERE id = ${match.matchId}`;
			return row?.body_hash as Uint8Array | undefined;
		};

		/** A retry of a stored match: fine when the body is the same, a conflict otherwise. */
		const answerRetry = (existing: Uint8Array) => {
			if (!Buffer.from(existing).equals(hash)) {
				throw new ApiError(
					"conflict",
					409,
					"This match was already reported with different results.",
				);
			}
			return false;
		};

		// A retry of a stored match is answered from the stored hash, before anything else is looked up.
		const before = await storedHash();
		if (before) return answerRetry(before);

		const [room] = await tx`
			SELECT id, tournament_id
			FROM rooms
			WHERE code = ${match.roomCode} AND game_slug = ${match.game}`;

		if (!room) {
			throw new ApiError("unknown_room", 422, "The match names a room that does not exist.");
		}

		const inserted = await tx`
			INSERT INTO matches (
				id,
				game_slug,
				room_id,
				rules_version,
				started_at,
				ended_at,
				end_reason,
				body_hash
			)
			VALUES (
				${match.matchId},
				${match.game},
				${room.id},
				${match.rulesVersion},
				${match.startedAt},
				${match.endedAt},
				${match.endReason},
				${hash}
			)
			ON CONFLICT (id) DO NOTHING
			RETURNING id`;

		// A concurrent retry got there first.
		if (inserted.length === 0) {
			return answerRetry((await storedHash())!);
		}

		const playerIds = humanPlayerIds(match.players);
		if (playerIds.length > 0) {
			const [{ n: known }] = await tx`
				SELECT count(*)::int AS n
				FROM players
				WHERE id IN ${tx(playerIds)}`;

			if (known !== playerIds.length) {
				throw new ApiError("unknown_player", 422, "The match lists a player that does not exist.");
			}
		}

		const seatRows = match.players.map((player) => ({
			match_id: match.matchId,
			seat: player.seat,
			player_id: player.playerId,
			bot_name: player.botName ?? null,
			placement: player.placement,
			score: player.score,
		}));
		await tx`INSERT INTO match_players ${tx(seatRows)}`;

		// A tournament room plays one match: its report closes the room (and the tournament, if it was the last).
		if (room.tournament_id) {
			await closeRoom(tx, room.id, match.endReason, match.startedAt);
		}

		const events = JSON.stringify(match.log.events);
		await tx`
			INSERT INTO match_logs (match_id, log_version, event_count, events)
			VALUES (
				${match.matchId},
				${match.log.logVersion},
				${match.log.events.length},
				${events}::text::jsonb
			)`;

		return true;
	});
}

/**
 * The player's own record per game: finished matches played, won (placed first), and the longest run of wins in
 * a row. Matches an admin terminated count for none of them.
 */
export async function stats(sql: SQL, playerId: string) {
	// A run of wins is a stretch where a game's match number and its win number move together
	// (gaps and islands): within one run, match number minus win number stays the same.
	const rows = await sql`
		WITH finished AS (
			SELECT
				m.game_slug,
				mp.placement = 1 AS won,
				row_number() OVER (PARTITION BY m.game_slug ORDER BY m.ended_at, m.id) AS nth,
				row_number() OVER (
					PARTITION BY m.game_slug, mp.placement = 1
					ORDER BY m.ended_at, m.id
				) AS nth_same
			FROM match_players mp
			JOIN matches m ON m.id = mp.match_id
			WHERE mp.player_id = ${playerId}
				AND m.end_reason = 'finished'
		),
		streaks AS (
			SELECT game_slug, count(*)::int AS length
			FROM finished
			WHERE won
			GROUP BY game_slug, nth - nth_same
		)
		SELECT
			f.game_slug AS game,
			count(*)::int AS played,
			count(*) FILTER (WHERE f.won)::int AS wins,
			coalesce((SELECT max(s.length) FROM streaks s WHERE s.game_slug = f.game_slug), 0)::int
				AS best_streak
		FROM finished f
		GROUP BY f.game_slug
		ORDER BY f.game_slug`;

	return {
		games: rows.map((row: { game: string; played: number; wins: number; best_streak: number }) => ({
			game: row.game,
			played: row.played,
			wins: row.wins,
			bestStreak: row.best_streak,
		})),
	};
}

/** The player's own history, newest first. Cursor = last match id of the previous page. */
export async function history(sql: SQL, playerId: string, cursor: string | undefined) {
	const afterCursor = cursor ? sql`AND mp.match_id < ${cursor}` : sql``;

	const rows = await sql`
		SELECT
			m.id,
			m.game_slug,
			r.code AS room_code,
			m.started_at,
			m.ended_at,
			m.end_reason,
			mp.seat,
			mp.placement,
			mp.score,
			(SELECT count(*)::int FROM match_players x WHERE x.match_id = m.id) AS players
		FROM match_players mp
		JOIN matches m ON m.id = mp.match_id
		JOIN rooms r ON r.id = m.room_id
		WHERE mp.player_id = ${playerId} ${afterCursor}
		ORDER BY mp.match_id DESC
		LIMIT ${HISTORY_PAGE + 1}`;

	const page = rows.slice(0, HISTORY_PAGE);
	const hasMore = rows.length > HISTORY_PAGE;

	return {
		matches: page.map((row: any) => ({
			id: row.id,
			game: row.game_slug,
			roomCode: row.room_code,
			startedAt: row.started_at.toISOString(),
			endedAt: row.ended_at.toISOString(),
			endReason: row.end_reason,
			players: row.players,
			seat: row.seat,
			placement: row.placement,
			score: row.score,
		})),
		nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
	};
}
