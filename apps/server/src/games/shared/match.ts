// What every game sends the platform when a match ends: placements, a game-defined score
// per seat, and the full move log (docs/architecture/match-log.md).

/** One step of the move log, before it gets its place (`seq`) and time (`t`, ms since the start). */
export type LogEntry = { type: string; seat?: number; data?: Record<string, unknown> };
export type LogEvent = LogEntry & { seq: number; t: number };

/** The match in progress: its id, when it started, and how many log events it has so far. */
export type MatchState = { id: string; startedAt: string; seq: number };

/** A finished match, as the platform's POST /v1/matches takes it. `score` is game-defined. */
export type MatchReport = {
	matchId: string;
	game: string;
	roomCode: string;
	rulesVersion: number;
	startedAt: string;
	endedAt: string;
	players: {
		seat: number;
		playerId: string | null;
		bot: boolean;
		botName?: string;
		placement: number;
		score: number;
	}[];
	log: { logVersion: number; events: LogEvent[] };
};

/** Starts the record of a new match. */
export const newMatch = (): MatchState => ({
	id: uuidv7(),
	startedAt: new Date().toISOString(),
	seq: 0,
});

/** Gives new log entries their place and time. The clock may step back, so `t` never goes below 0. */
export function stamp<M extends MatchState>(
	match: M,
	entries: LogEntry[],
	now: number,
): { match: M; events: LogEvent[] } {
	const t = Math.max(0, now - Date.parse(match.startedAt));
	const events = entries.map((e, i) => ({ seq: match.seq + i, t, ...e }));
	return { match: { ...match, seq: match.seq + entries.length }, events };
}

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
