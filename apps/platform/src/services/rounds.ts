// Round history and per-round seeds (docs/architecture/fairness.md): a room sends each round as it closes, with
// the round's server seed revealed, so a match shows its rounds while it is still played. Rounds are public,
// like matches.
import type { SQL } from "bun";
import { z } from "zod";
import { ApiError } from "../lib/http";
import { LogEvent } from "./matches";

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const CardId = z.string().regex(/^[a-z0-9-]{1,32}$/);
const MAX_RESULT_BYTES = 4 * 1024;
const MAX_ROUND_EVENTS = 2_000;

/** One shuffle of a round: its count in the round (the deal is 0), its client seed and its cards, top first. */
const Shuffle = z.object({
	nonce: z.number().int().min(0).max(100),
	clientSeed: z.string().min(1).max(100),
	deck: z.array(CardId).min(1).max(200),
});

/** A closed round as a room reports it. */
export const RoundReport = z
	.object({
		roundId: z.uuidv7(),
		game: z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game."),
		roomCode: z.string().regex(/^[A-Z0-9]{4,8}$/),
		round: z.number().int().min(1).max(1000),
		serverSeedHash: Hex64,
		serverSeed: Hex64,
		shuffles: z
			.array(Shuffle)
			.min(1)
			.max(50)
			.refine(
				(shuffles) => shuffles.every((shuffle, index) => shuffle.nonce === index),
				"Nonces must count 0, 1, 2… in order.",
			),
		/** What happened in the round, in the game's own shape. */
		result: z
			.record(z.string(), z.unknown())
			.refine(
				(result) => JSON.stringify(result).length <= MAX_RESULT_BYTES,
				`Must be at most ${MAX_RESULT_BYTES} bytes.`,
			),
		/** Every move of the round from its deal on, as the match's move log has them. */
		events: z.array(LogEvent).min(1).max(MAX_ROUND_EVENTS),
		startedAt: z.iso.datetime({ offset: true }),
		endedAt: z.iso.datetime({ offset: true }),
	})
	.superRefine((round, ctx) => {
		if (Date.parse(round.endedAt) < Date.parse(round.startedAt)) {
			ctx.addIssue({ code: "custom", message: "Must not be before startedAt.", path: ["endedAt"] });
		}

		const hash = new Bun.CryptoHasher("sha256").update(round.serverSeed).digest("hex");
		if (hash !== round.serverSeedHash) {
			ctx.addIssue({
				code: "custom",
				message: "The server seed does not match its hash.",
				path: ["serverSeed"],
			});
		}
	});
export type RoundReport = z.output<typeof RoundReport>;

const hashRound = (matchId: string, round: RoundReport) =>
	new Bun.CryptoHasher("sha256").update(JSON.stringify({ matchId, ...round })).digest();

const conflict = (message: string) => new ApiError("conflict", 409, message);

/** Every client seed must be match id, round and nonce: the only seed a player can rebuild on their own. */
function checkClientSeeds(matchId: string, round: RoundReport) {
	const wrong = round.shuffles.find(
		(shuffle) => shuffle.clientSeed !== `${matchId}:${round.round}:${shuffle.nonce}`,
	);
	if (!wrong) {
		return;
	}

	throw new ApiError("bad_input", 400, "Some fields are invalid.", {
		shuffles: "Each client seed must be matchId:round:nonce.",
	});
}

/**
 * Stores a closed round with its fairness. Idempotent by match and round: a retry with the same body returns
 * false; another body for the same round, or a round id used twice, is a conflict. Every round of a match must
 * come from one room.
 */
export async function recordRound(sql: SQL, matchId: string, round: RoundReport): Promise<boolean> {
	checkClientSeeds(matchId, round);
	const hash = hashRound(matchId, round);

	return sql.begin(async (tx) => {
		const storedHash = async () => {
			const [row] = await tx`
				SELECT body_hash
				FROM match_rounds
				WHERE match_id = ${matchId} AND round = ${round.round}`;

			return row?.body_hash as Uint8Array | undefined;
		};

		const answerRetry = (existing: Uint8Array | undefined) => {
			if (!existing || !Buffer.from(existing).equals(hash)) {
				throw conflict("This round was already reported with different results.");
			}

			return false;
		};

		const before = await storedHash();
		if (before) {
			return answerRetry(before);
		}

		const [room] = await tx`
			SELECT id
			FROM rooms
			WHERE code = ${round.roomCode} AND game_slug = ${round.game}`;

		if (!room) {
			throw new ApiError("unknown_room", 422, "The round names a room that does not exist.");
		}

		const [sibling] = await tx`
			SELECT room_id
			FROM match_rounds
			WHERE match_id = ${matchId}
			LIMIT 1`;

		if (sibling && sibling.room_id !== room.id) {
			throw conflict("Every round of a match must come from one room.");
		}

		const result = JSON.stringify(round.result);
		const events = JSON.stringify(round.events);
		const inserted = await tx`
			INSERT INTO match_rounds (
				id,
				match_id,
				round,
				game_slug,
				room_id,
				result,
				events,
				started_at,
				ended_at,
				body_hash
			)
			VALUES (
				${round.roundId},
				${matchId},
				${round.round},
				${round.game},
				${room.id},
				${result}::text::jsonb,
				${events}::text::jsonb,
				${round.startedAt},
				${round.endedAt},
				${hash}
			)
			ON CONFLICT DO NOTHING
			RETURNING id`;

		// A concurrent retry got there first, or the round id belongs to another round.
		if (inserted.length === 0) {
			return answerRetry(await storedHash());
		}

		const fairnessRows = round.shuffles.map((shuffle) => ({
			round_id: round.roundId,
			match_id: matchId,
			nonce: shuffle.nonce,
			server_seed_hash: round.serverSeedHash,
			server_seed: round.serverSeed,
			client_seed: shuffle.clientSeed,
			deck: JSON.stringify(shuffle.deck),
		}));
		for (const row of fairnessRows) {
			await tx`
				INSERT INTO round_fairness (
					round_id,
					match_id,
					nonce,
					server_seed_hash,
					server_seed,
					client_seed,
					deck
				)
				VALUES (
					${row.round_id},
					${row.match_id},
					${row.nonce},
					${row.server_seed_hash},
					${row.server_seed},
					${row.client_seed},
					${row.deck}::text::jsonb
				)`;
		}

		return true;
	});
}

type RoundRow = {
	id: string;
	round: number;
	game_slug: string;
	result: Record<string, unknown>;
	events: unknown[];
	started_at: Date;
	ended_at: Date;
	server_seed_hash: string;
	server_seed: string;
	shuffles: { nonce: number; client_seed: string; deck: string[] }[];
};

/**
 * A match's closed rounds, oldest first, running or finished, each with its revealed seed and shuffles, and who
 * sat in each seat once the match is reported.
 */
export async function matchRounds(sql: SQL, matchId: string) {
	const [match] = await sql`
		SELECT game_slug
		FROM matches
		WHERE id = ${matchId}`;

	const rows = (await sql`
		SELECT
			r.id,
			r.round,
			r.game_slug,
			r.result,
			r.events,
			r.started_at,
			r.ended_at,
			min(f.server_seed_hash) AS server_seed_hash,
			min(f.server_seed) AS server_seed,
			jsonb_agg(
				jsonb_build_object('nonce', f.nonce, 'client_seed', f.client_seed, 'deck', f.deck)
				ORDER BY f.nonce
			) AS shuffles
		FROM match_rounds r
		JOIN round_fairness f ON f.round_id = r.id
		WHERE r.match_id = ${matchId}
		GROUP BY r.id
		ORDER BY r.round`) as RoundRow[];

	if (!match && rows.length === 0) {
		return null;
	}

	// Who sat where, once the match is reported; a running match has no seats here yet.
	const players = (await sql`
		SELECT
			mp.seat,
			coalesce(p.display_name, mp.bot_name) AS name
		FROM match_players mp
		LEFT JOIN players p ON p.id = mp.player_id
		WHERE mp.match_id = ${matchId}
		ORDER BY mp.seat`) as { seat: number; name: string }[];

	const rounds = rows.map((row) => ({
		id: row.id,
		round: row.round,
		startedAt: row.started_at.toISOString(),
		endedAt: row.ended_at.toISOString(),
		result: row.result,
		events: row.events,
		serverSeedHash: row.server_seed_hash,
		serverSeed: row.server_seed,
		shuffles: row.shuffles.map((shuffle) => ({
			nonce: shuffle.nonce,
			clientSeed: shuffle.client_seed,
			deck: shuffle.deck,
		})),
	}));

	return {
		match: {
			id: matchId,
			game: match?.game_slug ?? rows[0]!.game_slug,
			finished: Boolean(match),
			players,
		},
		rounds,
	};
}
