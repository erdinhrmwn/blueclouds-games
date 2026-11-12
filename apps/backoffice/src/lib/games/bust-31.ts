import type { LogEvent, MatchLog, ReplaySeat, SeatState, Step, TableState } from '../replay.ts';

// Keep in step with apps/server/src/games/bust-31/rules.ts (rules version 1).
const LIMIT = 31;
const START_LIVES = 3;
const MINUS_VALUE = 5;

/** Card ids say what the card is: n7-2 is a 7, z-0 a zero, m-1 a minus five, r-3 a reverse. */
function cardOf(id: string): { value: number; reverse: boolean; label: string } {
	const kind = id[0];
	if (kind === 'n') {
		const value = Number(id.slice(1, id.indexOf('-')));
		return { value, reverse: false, label: String(value) };
	}
	if (kind === 'm') return { value: -MINUS_VALUE, reverse: false, label: `-${MINUS_VALUE}` };
	if (kind === 'r') return { value: 0, reverse: true, label: 'Reverse' };
	return { value: 0, reverse: false, label: '0' };
}

const BY: Record<string, string> = {
	timeout: ' (time ran out, played for them)',
	away: ' (away, played for them)'
};

/**
 * Folds a Bust 31 log into one table state per event. The server's own numbers in the log
 * (totals, lives, cards drawn) are compared with the replay; any difference is flagged.
 */
export function replayBust31(log: MatchLog, seats: ReplaySeat[]): Step[] {
	const order = [...seats].sort((a, b) => a.seat - b.seat).map((s) => s.seat);
	const name = (seat: number | undefined) =>
		seats.find((s) => s.seat === seat)?.name ?? `Seat ${(seat ?? 0) + 1}`;

	const table = new Map<number, { lives: number; hand: string[]; away: boolean }>(
		order.map((seat) => [seat, { lives: START_LIVES, hand: [], away: false }])
	);

	let round = 0;
	let total = 0;
	let direction = 1;
	let turn: number | null = null;
	let deck: string[] = [];
	let pile: string[] = [];

	const nextAlive = (from: number) => {
		const start = order.indexOf(from);
		const count = order.length;

		for (let step = 1; step <= count; step++) {
			// Wraps around both ways: ((x % n) + n) % n is never negative.
			const index = (((start + step * direction) % count) + count) % count;
			const seat = order[index]!;
			if (table.get(seat)!.lives > 0) return seat;
		}

		return from;
	};

	const snapshot = (): TableState => ({
		round,
		total,
		limit: LIMIT,
		clockwise: direction === 1,
		turnSeat: turn,
		pileTop: pile.length ? cardOf(pile.at(-1)!).label : null,
		deckCount: deck.length,
		seats: order.map((seat): SeatState => {
			const state = table.get(seat)!;
			const hand = state.hand.map((id) => cardOf(id).label);

			return { seat, lives: state.lives, hand, away: state.away };
		})
	});

	return log.events.map((event: LogEvent): Step => {
		const data = (event.data ?? {}) as Record<string, any>;
		const who = name(event.seat);
		const player = event.seat === undefined ? undefined : table.get(event.seat);
		const playedBy = BY[data.by] ?? '';

		const mismatches: string[] = [];
		const expect = (what: string, logged: unknown, replayed: unknown) => {
			if (logged !== replayed) {
				mismatches.push(`${what}: logged ${String(logged)}, replay ${String(replayed)}`);
			}
		};

		let text: string;

		switch (event.type) {
			case 'deal': {
				round = data.round;
				deck = [...data.deck];
				pile = [];
				total = 0;
				direction = 1;
				turn = data.starter;

				for (const [seat, state] of table) {
					state.hand = [...(data.hands[seat] ?? [])];
				}

				text = `Round ${round} dealt. ${name(data.starter)} starts.`;
				break;
			}
			case 'reshuffle':
				deck = [...data.deck];
				pile = [];
				text = 'The deck ran out. The pile was shuffled into a new deck.';
				break;
			case 'play':
			case 'bust': {
				const card = cardOf(data.card);

				if (!player || !player.hand.includes(data.card)) {
					mismatches.push(`${data.card} was not in ${who}'s hand`);
				}
				if (player) {
					player.hand = player.hand.filter((id) => id !== data.card);
				}

				expect('Turn', event.seat, turn);
				total = Math.max(0, total + card.value);
				expect('Total', data.total, total);
				pile.push(data.card);

				if (event.type === 'play') {
					const drew = deck.shift() ?? null;
					expect('Card drawn', data.drew, drew);

					if (player && drew) player.hand.push(drew);
					if (card.reverse) direction = -direction;

					turn = nextAlive(event.seat!);
					text = `${who} played ${card.label}. Total ${total}.${playedBy}`;
					break;
				}

				if (player) player.lives = Math.max(0, player.lives - 1);
				expect('Lives', data.lives, player?.lives);
				turn = null;

				const lifeWord = player?.lives === 1 ? 'life' : 'lives';
				const left = data.eliminated ? 'and is out' : `${player?.lives} ${lifeWord} left`;
				text = `${who} went over ${LIMIT} with ${card.label}. Total ${total}, ${left}.${playedBy}`;
				break;
			}
			case 'away':
				if (player) player.away = true;
				text = `${who} closed the game. Their turns are played for them.`;
				break;
			case 'back':
				if (player) player.away = false;
				text = `${who} came back.`;
				break;
			case 'finished':
				turn = null;
				text = `${name(data.winner)} wins.`;
				break;
			default:
				text = `${event.type} ${JSON.stringify(event.data ?? {})}`;
		}

		return {
			event,
			text,
			state: snapshot(),
			...(mismatches.length ? { mismatch: mismatches.join('; ') } : {})
		};
	});
}
