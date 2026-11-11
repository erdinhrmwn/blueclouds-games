/** A finished match, as the platform's POST /v1/matches takes it. `score` is game-defined. */
export type MatchReport = {
	matchId: string;
	game: string;
	roomCode: string;
	rulesVersion: number;
	startedAt: string;
	endedAt: string;
	players: { seat: number; playerId: string | null; bot: boolean; botName?: string; placement: number; score: number }[];
};

/**
 * A UUIDv7 (time-ordered), as the platform wants for match ids. Not Bun.randomUUIDv7():
 * the web app type-checks this file too, without Bun's types.
 */
export function uuidv7(now = Date.now()): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff; // 48-bit ms timestamp
	b[6] = (b[6]! & 0x0f) | 0x70; // version 7
	b[8] = (b[8]! & 0x3f) | 0x80; // RFC 9562 variant
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
