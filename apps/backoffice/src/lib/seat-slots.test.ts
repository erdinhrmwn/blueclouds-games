import { expect, test } from 'bun:test';
import { seatSlots } from './seat-slots';

const player = (name: string, seat: number | null) => ({ name, playerId: null, bot: false, seat });

test('players sit in their own seat; unseated or clashing ones fill the first empty seats; nobody is hidden', () => {
	const cases: { seats: number; players: ReturnType<typeof player>[]; shown: (string | null)[] }[] =
		[
			{
				seats: 6,
				players: [player('Rina', 4), player('Bayu', 0)],
				shown: ['Bayu', null, null, null, 'Rina', null]
			},
			{
				seats: 4,
				players: [player('A', 1), player('B', null), player('C', 1)],
				shown: ['B', 'A', 'C', null]
			},
			{ seats: 1, players: [player('A', 0), player('B', 0)], shown: ['A', 'B'] }
		];

	for (const { seats, players, shown } of cases) {
		expect(seatSlots(seats, players).map((slot) => slot?.name ?? null)).toEqual(shown);
	}
});
