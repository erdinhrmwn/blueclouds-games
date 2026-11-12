import { describe, expect, test } from 'bun:test';
import { seatSlots } from './seat-slots';

const player = (name: string, seat: number | null) => ({ name, playerId: null, bot: false, seat });

describe('seat slots', () => {
	test('players sit in their own seat and empty seats stay empty', () => {
		const slots = seatSlots(6, [player('Rina', 4), player('Bayu', 0)]);

		expect(slots.map((slot) => slot?.name ?? null)).toEqual([
			'Bayu',
			null,
			null,
			null,
			'Rina',
			null
		]);
	});

	test('players without a seat, or with a taken one, fill the first empty seats', () => {
		const slots = seatSlots(4, [player('A', 1), player('B', null), player('C', 1)]);

		expect(slots.map((slot) => slot?.name ?? null)).toEqual(['B', 'A', 'C', null]);
	});

	test('more players than seats still shows everyone', () => {
		const slots = seatSlots(1, [player('A', 0), player('B', 0)]);

		expect(slots.map((slot) => slot?.name ?? null)).toEqual(['A', 'B']);
	});
});
