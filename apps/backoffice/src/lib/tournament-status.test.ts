import { expect, test } from 'bun:test';
import { duration } from './tournament-status';

const after = (ms: number) => duration(new Date(0), new Date(ms));

test('a duration shows seconds under an hour, and hours and minutes past it', () => {
	expect(after(42_000)).toBe('42 sec');
	expect(after(185_000)).toBe('3 min 5 sec');
	expect(after(60_000)).toBe('1 min 0 sec');
	expect(after(5_100_000)).toBe('1 h 25 min');
	expect(after(93_900_000)).toBe('26 h 5 min');
	expect(after(-5_000)).toBe('0 sec');
});
