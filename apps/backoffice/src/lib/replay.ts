import { replayBust31 } from './games/bust-31.ts';

/** One event of a match's move log, as the room sent it (docs/architecture/match-log.md). */
export type LogEvent = {
	seq: number;
	t: number;
	type: string;
	seat?: number;
	data?: Record<string, unknown>;
};

export type MatchLog = { logVersion: number; events: LogEvent[] };

export type ReplaySeat = { seat: number; name: string | null };

/** One seat at the table after a step. Cards are labels such as "7", "0", "-5", "Reverse". */
export type SeatState = { seat: number; lives: number; hand: string[]; away: boolean };

export type TableState = {
	round: number;
	total: number;
	limit: number;
	clockwise: boolean;
	turnSeat: number | null;
	pileTop: string | null;
	deckCount: number;
	seats: SeatState[];
};

/** What the timeline shows for one event. `mismatch` is set when the replay disagrees with what the server logged. */
export type Step = { event: LogEvent; text: string; state: TableState | null; mismatch?: string };

/** Games with their own renderer. Any other game falls back to the raw events. */
const RENDERERS: Record<string, (log: MatchLog, seats: ReplaySeat[]) => Step[]> = {
	'bust-31': replayBust31
};

/** The timeline text of a provably fair event (docs/architecture/fairness.md), the same for every game. */
export function fairnessText(event: LogEvent): string | null {
	const data = event.data ?? {};

	switch (event.type) {
		case 'fairness':
			return `Round ${String(data.round)} seed committed. Server seed hash ${String(data.serverSeedHash)}.`;
		case 'shuffle': {
			const cards = (data.deck as unknown[] | undefined)?.length ?? 0;

			return `Shuffle #${String(data.nonce)} of round ${String(data.round)}: ${cards} cards.`;
		}
		case 'reveal':
			return `Round ${String(data.round)} server seed revealed: ${String(data.serverSeed)}.`;
		default:
			return null;
	}
}

export function replay(game: string, log: MatchLog, seats: ReplaySeat[]): Step[] {
	const render = Object.hasOwn(RENDERERS, game) ? RENDERERS[game] : undefined;
	if (render && log.logVersion === 1) {
		return render(log, seats);
	}

	/** "Ann: " before a seat's event, nothing before a table event. */
	const prefix = (seat?: number) => {
		if (seat === undefined) {
			return '';
		}

		const name = seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;
		return `${name}: `;
	};

	return log.events.map((event) => ({
		event,
		text:
			fairnessText(event) ??
			`${prefix(event.seat)}${event.type} ${JSON.stringify(event.data ?? {})}`,
		state: null
	}));
}
