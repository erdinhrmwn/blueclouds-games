import type { LogEvent, MatchLog, ReplaySeat, SeatState, Step, TableState } from '../replay.ts';

// Keep in step with apps/server/src/games/bust-31/rules.ts (rules version 1).
const LIMIT = 31;
const START_LIVES = 3;

/** Card ids say what the card is: n7-2 is a 7, z-0 a zero, m-1 a minus five, r-3 a reverse. */
function cardOf(id: string): { value: number; reverse: boolean; label: string } {
	const kind = id[0];
	if (kind === 'n') {
		const value = Number(id.slice(1, id.indexOf('-')));
		return { value, reverse: false, label: String(value) };
	}
	if (kind === 'm') return { value: -5, reverse: false, label: '-5' };
	if (kind === 'r') return { value: 0, reverse: true, label: 'Reverse' };
	return { value: 0, reverse: false, label: '0' };
}

const BY: Record<string, string> = { timeout: ' (time ran out, played for them)', away: ' (away, played for them)' };

/**
 * Folds a Bust 31 log into one table state per event. The server's own numbers in the log
 * (totals, lives, cards drawn) are compared with the replay; any difference is flagged.
 */
export function replayBust31(log: MatchLog, seats: ReplaySeat[]): Step[] {
	const order = [...seats].sort((a, b) => a.seat - b.seat).map((s) => s.seat);
	const name = (seat: number | undefined) => seats.find((s) => s.seat === seat)?.name ?? `Seat ${(seat ?? 0) + 1}`;
	const table = new Map<number, { lives: number; hand: string[]; away: boolean }>(order.map((s) => [s, { lives: START_LIVES, hand: [], away: false }]));
	let round = 0;
	let total = 0;
	let direction = 1;
	let turn: number | null = null;
	let deck: string[] = [];
	let pile: string[] = [];

	const nextAlive = (from: number) => {
		const i = order.indexOf(from);
		for (let step = 1; step <= order.length; step++) {
			const seat = order[(((i + step * direction) % order.length) + order.length) % order.length]!;
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
			const s = table.get(seat)!;
			return { seat, lives: s.lives, hand: s.hand.map((id) => cardOf(id).label), away: s.away };
		})
	});

	return log.events.map((event: LogEvent): Step => {
		const d = (event.data ?? {}) as Record<string, any>;
		const who = name(event.seat);
		const player = event.seat === undefined ? undefined : table.get(event.seat);
		const mismatches: string[] = [];
		const expect = (what: string, logged: unknown, replayed: unknown) => {
			if (logged !== replayed) mismatches.push(`${what}: logged ${String(logged)}, replay ${String(replayed)}`);
		};
		let text: string;

		switch (event.type) {
			case 'deal': {
				round = d.round;
				deck = [...d.deck];
				pile = [];
				total = 0;
				direction = 1;
				turn = d.starter;
				for (const [seat, s] of table) s.hand = [...(d.hands[seat] ?? [])];
				text = `Round ${round} dealt. ${name(d.starter)} starts.`;
				break;
			}
			case 'reshuffle':
				deck = [...d.deck];
				pile = [];
				text = 'The deck ran out. The pile was shuffled into a new deck.';
				break;
			case 'play':
			case 'bust': {
				const card = cardOf(d.card);
				if (!player || !player.hand.includes(d.card)) mismatches.push(`${d.card} was not in ${who}'s hand`);
				if (player) player.hand = player.hand.filter((c) => c !== d.card);
				expect('Turn', event.seat, turn);
				total = Math.max(0, total + card.value);
				expect('Total', d.total, total);
				pile.push(d.card);
				if (event.type === 'play') {
					const drew = deck.shift() ?? null;
					expect('Card drawn', d.drew, drew);
					if (player && drew) player.hand.push(drew);
					if (card.reverse) direction = -direction;
					turn = nextAlive(event.seat!);
					text = `${who} played ${card.label}. Total ${total}.${BY[d.by] ?? ''}`;
				} else {
					if (player) player.lives = Math.max(0, player.lives - 1);
					expect('Lives', d.lives, player?.lives);
					turn = null;
					const left = d.eliminated ? 'and is out' : `${player?.lives} ${player?.lives === 1 ? 'life' : 'lives'} left`;
					text = `${who} went over ${LIMIT} with ${card.label}. Total ${total}, ${left}.${BY[d.by] ?? ''}`;
				}
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
				text = `${name(d.winner)} wins.`;
				break;
			default:
				text = `${event.type} ${JSON.stringify(event.data ?? {})}`;
		}
		return { event, text, state: snapshot(), ...(mismatches.length ? { mismatch: mismatches.join('; ') } : {}) };
	});
}
