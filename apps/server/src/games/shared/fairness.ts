// Provably fair shuffles (docs/architecture/fairness.md). Pure and Web Crypto only, so the room, the backoffice
// and the player's browser all check a match the same way.
//
// Before a match the room commits to sha256(serverSeed) and to the match id. When it starts, the client seed is
// fixed as the match id plus who sits in which seat, so the cards are bound to the seating. Shuffle number
// `nonce` (0, 1, 2… in the match) draws its numbers from HMAC_SHA256(serverSeed, "clientSeed:nonce:block"),
// 8 per 32-byte block (4 bytes each, big-endian, / 2^32). The cards are first put in id order, then shuffled
// Fisher-Yates from the end. The server seed is revealed when the match ends.

/** What the room commits to before a match: the match id (the client seed) and the hash of its server seed. */
export type Commitment = { matchId: string; serverSeedHash: string };

/** The seeds of the match being played and how many shuffles it had so far (the next shuffle's nonce). */
export type MatchSeeds = Commitment & { serverSeed: string; clientSeed: string; nonce: number };

/** A finished match's seeds and shuffles, kept by the room after it ends so anyone at the table can check it. */
export type Revealed = Commitment & {
	serverSeed: string;
	clientSeed: string;
	shuffles: ShuffleRecord[];
};

/** Who sits in a seat, as the match report says: a player's id, or a bot's name. */
export type SeatHolder = { seat: number; playerId: string | null; botName?: string };

/**
 * The client seed: the match id, then each seat in order with its player id or "bot:<name>", e.g.
 * "0192…|0:0192…,2:bot:Bot Rain". The platform rebuilds it from the report's players.
 */
export function clientSeedOf(matchId: string, seats: SeatHolder[]): string {
	const seating = [...seats]
		.sort((left, right) => left.seat - right.seat)
		.map((holder) => `${holder.seat}:${holder.playerId ?? `bot:${holder.botName}`}`)
		.join(",");

	return `${matchId}|${seating}`;
}

/** One logged shuffle: its place in the match and the cards it produced, top first. */
export type ShuffleRecord = { nonce: number; deck: string[] };

/** What a finished match reveals, enough to check every shuffle in it. */
export type FairnessProof = {
	serverSeed: string;
	serverSeedHash: string;
	clientSeed: string;
	shuffles: ShuffleRecord[];
};

/** The result of checking a match: the seed against its hash, then each shuffle. */
export type FairnessCheck = {
	hashMatches: boolean;
	shuffles: { nonce: number; ok: boolean }[];
	ok: boolean;
};

export const SERVER_SEED = /^[0-9a-f]{64}$/;

const FLOATS_PER_BLOCK = 8;
const UINT32 = 2 ** 32;
const encoder = new TextEncoder();

/** The HMAC message for one block of numbers. */
export const blockMessage = (clientSeed: string, nonce: number, block: number) =>
	`${clientSeed}:${nonce}:${block}`;

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

/** The numbers for shuffle `nonce`, `count` of them. */
async function shuffleFloats(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
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
		const message = encoder.encode(blockMessage(clientSeed, nonce, block));
		const digest = await crypto.subtle.sign("HMAC", key, message);
		floats.push(...floatsOf(new Uint8Array(digest)));
	}

	return floats;
}

/**
 * Checks a finished match: the revealed seed matches the hash shown before it, the shuffles are numbered
 * 0, 1, 2… and each one is exactly what the seeds give for its cards.
 */
export async function checkFairness(proof: FairnessProof): Promise<FairnessCheck> {
	const hashMatches =
		SERVER_SEED.test(proof.serverSeed) &&
		(await sha256Hex(proof.serverSeed)) === proof.serverSeedHash;

	const shuffles: FairnessCheck["shuffles"] = [];
	for (const [index, record] of proof.shuffles.entries()) {
		const cards = canonical(record.deck.map((id) => ({ id })));
		const floats = await shuffleFloats(
			proof.serverSeed,
			proof.clientSeed,
			record.nonce,
			floatsNeeded(cards.length),
		);
		const expected = fisherYates(cards, floats).map((card) => card.id);
		const ok = record.nonce === index && expected.join(",") === record.deck.join(",");

		shuffles.push({ nonce: record.nonce, ok });
	}

	const ok = hashMatches && shuffles.every((shuffle) => shuffle.ok);

	return { hashMatches, shuffles, ok };
}

/** The fairness events of a move log: the commitment at the start, each shuffle and the reveal at the end. */
export function proofFromLog(
	events: { type: string; data?: Record<string, unknown> }[],
): FairnessProof | null {
	const start = events.find((event) => event.type === "fairness")?.data;
	const reveal = events.find((event) => event.type === "reveal")?.data;
	if (!start || !reveal) {
		return null;
	}

	const shuffles = events
		.filter((event) => event.type === "shuffle")
		.map((event) => ({
			nonce: Number(event.data?.nonce),
			deck: (event.data?.deck as string[] | undefined) ?? [],
		}));

	return {
		serverSeed: String(reveal.serverSeed),
		serverSeedHash: String(start.serverSeedHash),
		clientSeed: String(start.clientSeed),
		shuffles,
	};
}
