// Provably fair shuffles (docs/architecture/fairness.md). Pure and Web Crypto only, so the room, the backoffice
// and the player's browser all check a round the same way.
//
// Every round has its own server seed. The room commits to sha256(serverSeed) and to the round's id before the
// round is dealt, and reveals the seed when the round closes. Every shuffle has its own client seed,
// "matchId:round:nonce": the round it deals or reshuffles in and its count within that round (0, 1, 2…). The
// shuffle draws its numbers from HMAC_SHA256(serverSeed, "clientSeed:block"), 8 per 32-byte block (4 bytes each,
// big-endian, / 2^32); a deck needs more than one block, and `block` only counts them. The cards are first put in
// id order, then shuffled Fisher-Yates from the end.

/** What the room commits to before a round is dealt: the round's id and the hash of its server seed. */
export type RoundCommitment = { roundId: string; serverSeedHash: string };

/** A round's commitment with its seed, kept by the room until the round closes and the seed is revealed. */
export type RoundSeed = RoundCommitment & { serverSeed: string };

/** A shuffle's place in the match: the round it deals or reshuffles in, and its count in that round, from 0. */
export type ShuffleKey = { round: number; nonce: number };

/** One logged shuffle: its place in the match and the cards it produced, top first. */
export type ShuffleRecord = ShuffleKey & { deck: string[] };

/**
 * The seeds of the match being played: the round being played (null before the first deal), the one it was
 * before (its seed is revealed when it closes), the next round's commitment, and the last shuffle's place.
 */
export type MatchSeeds = {
	matchId: string;
	current: (RoundSeed & { round: number }) | null;
	previous: (RoundSeed & { round: number }) | null;
	next: RoundSeed;
	last: ShuffleKey | null;
};

/** A shuffle's client seed, e.g. "0192…:2:1": match id, round, nonce. */
export function clientSeedOf(matchId: string, key: ShuffleKey): string {
	return `${matchId}:${key.round}:${key.nonce}`;
}

/** The nonce of a shuffle in `round`: one more than the last shuffle's in the same round, else 0. */
export function nextNonce(last: ShuffleKey | null, round: number): number {
	if (!last || last.round !== round) {
		return 0;
	}

	return last.nonce + 1;
}

/** Everything that checks one closed round: its revealed seed and its shuffles, in order. */
export type RoundProof = {
	matchId: string;
	round: number;
	serverSeed: string;
	serverSeedHash: string;
	shuffles: { nonce: number; deck: string[] }[];
};

/** The result of checking a round: the seed against its hash, then each shuffle. */
export type RoundCheck = {
	round: number;
	hashMatches: boolean;
	shuffles: { nonce: number; ok: boolean }[];
	ok: boolean;
};

export const SERVER_SEED = /^[0-9a-f]{64}$/;

const FLOATS_PER_BLOCK = 8;
const UINT32 = 2 ** 32;
const encoder = new TextEncoder();

/** The HMAC message for one block of numbers. */
export const blockMessage = (clientSeed: string, block: number) => `${clientSeed}:${block}`;

/** The 8 numbers in [0, 1) one HMAC digest gives. */
export function floatsOf(digest: Uint8Array): number[] {
	const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
	const floats: number[] = [];

	for (let index = 0; index < FLOATS_PER_BLOCK; index += 1) {
		floats.push(view.getUint32(index * 4) / UINT32);
	}

	return floats;
}

/** How many numbers a shuffle of `size` cards uses: one per swap. */
export const floatsNeeded = (size: number) => Math.max(0, size - 1);

/** How many HMAC blocks give `count` numbers. */
export const blocksFor = (count: number) => Math.ceil(count / FLOATS_PER_BLOCK);

/** Cards in id order, so a shuffle depends only on which cards go in, never on the order they lay in. */
export function canonical<T extends { id: string }>(items: T[]): T[] {
	return [...items].sort((left, right) => compareIds(left.id, right.id));
}

const compareIds = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}

	return left > right ? 1 : 0;
};

/** Fisher-Yates from the end with the given numbers, one per swap. */
export function fisherYates<T>(items: T[], floats: number[]): T[] {
	const out = [...items];

	for (let index = out.length - 1; index > 0; index -= 1) {
		const float = floats[out.length - 1 - index]!;
		const other = Math.floor(float * (index + 1));
		[out[index], out[other]] = [out[other]!, out[index]!];
	}

	return out;
}

const hex = (bytes: ArrayBuffer) =>
	Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** sha256 of the seed's text, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
	return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** The numbers for one shuffle, `count` of them. */
async function shuffleFloats(
	serverSeed: string,
	clientSeed: string,
	count: number,
): Promise<number[]> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(serverSeed),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const floats: number[] = [];
	for (let block = 0; block < blocksFor(count); block += 1) {
		const message = encoder.encode(blockMessage(clientSeed, block));
		const digest = await crypto.subtle.sign("HMAC", key, message);
		floats.push(...floatsOf(new Uint8Array(digest)));
	}

	return floats;
}

/**
 * Checks a closed round: the revealed seed matches the hash shown before the round, the nonces count 0, 1, 2…
 * and each shuffle is exactly what the seeds give for its cards.
 */
export async function checkRound(proof: RoundProof): Promise<RoundCheck> {
	const hashMatches =
		SERVER_SEED.test(proof.serverSeed) &&
		(await sha256Hex(proof.serverSeed)) === proof.serverSeedHash;

	const shuffles: RoundCheck["shuffles"] = [];
	for (const [index, record] of proof.shuffles.entries()) {
		const key = { round: proof.round, nonce: record.nonce };
		const cards = canonical(record.deck.map((id) => ({ id })));
		const floats = await shuffleFloats(
			proof.serverSeed,
			clientSeedOf(proof.matchId, key),
			floatsNeeded(cards.length),
		);
		const expected = fisherYates(cards, floats).map((card) => card.id);
		const ok = record.nonce === index && expected.join(",") === record.deck.join(",");

		shuffles.push({ nonce: record.nonce, ok });
	}

	const ok = hashMatches && shuffles.length > 0 && shuffles.every((shuffle) => shuffle.ok);

	return { round: proof.round, hashMatches, shuffles, ok };
}

/**
 * Checks a match's closed rounds: they run 1, 2, 3… with none skipped (so the room can't pick among rounds for
 * a deck it likes), and each one checks out.
 */
export async function checkMatch(
	rounds: RoundProof[],
): Promise<{ rounds: RoundCheck[]; ok: boolean }> {
	const checks: RoundCheck[] = [];
	for (const [index, proof] of rounds.entries()) {
		const check = await checkRound(proof);
		const inOrder = proof.round === index + 1;

		checks.push({ ...check, ok: check.ok && inOrder });
	}

	const ok = checks.every((check) => check.ok);

	return { rounds: checks, ok };
}

type Event = { type: string; data?: Record<string, unknown> };

/**
 * The closed rounds of a move log, oldest first: each round's commitment (`fairness`), its shuffles and its
 * revealed seed (`reveal`). A round still being played has no reveal yet and is left out.
 */
export function proofsFromLog(matchId: string, events: Event[]): RoundProof[] {
	const ofRound = (type: string, round: number) =>
		events.filter((event) => event.type === type && Number(event.data?.round) === round);

	const reveals = events.filter((event) => event.type === "reveal");

	return reveals.map((reveal) => {
		const round = Number(reveal.data?.round);
		const committed = ofRound("fairness", round).at(0);
		const shuffles = ofRound("shuffle", round).map((event) => ({
			nonce: Number(event.data?.nonce),
			deck: (event.data?.deck as string[] | undefined) ?? [],
		}));

		return {
			matchId,
			round,
			serverSeed: String(reveal.data?.serverSeed),
			serverSeedHash: String(committed?.data?.serverSeedHash),
			shuffles,
		};
	});
}
