import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase, room } from '../../../../platform/src/test-helpers';
import { CHART_DAYS, matchesPerDay, overviewStats } from './overview';

let sql: SQL;

beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;

	await sql`
		INSERT INTO players (display_name, is_vip, last_seen_at, created_at)
		VALUES
			('Rina', true, now(), now()),
			('Old timer', false, now() - interval '3 days', now() - interval '3 days')`;
	await sql`
		INSERT INTO players (display_name, is_bot)
		VALUES ('Bot Rain', true)`;

	const roomId = await room(sql, 'bust-31', 'ABCD');
	const hash = new Uint8Array(32);
	await sql`
		INSERT INTO matches (id, game_slug, room_id, rules_version, started_at, ended_at, body_hash)
		VALUES
			(uuidv7(), 'bust-31', ${roomId}, 1, now() - interval '5 min', now(), ${hash}),
			(uuidv7(), 'bust-31', ${roomId}, 1, now() - interval '40 days', now() - interval '40 days', ${hash})`;
});
afterAll(() => sql.close());

describe('overview', () => {
	test('counts people apart from bots, and the last 24 hours apart from all time', async () => {
		const stats = await overviewStats(sql);

		expect(stats.players).toEqual({
			total: 2,
			joinedLastDay: 1,
			seenLastDay: 1,
			vip: 1,
			bots: 1,
			disabled: 0
		});
		expect(stats.matches).toEqual({ total: 2, lastDay: 1 });
		expect(stats.tournaments).toEqual({ open: 0, needAttention: 0 });
	});

	test('matches per day: one row per UTC day ending today, empty days included', async () => {
		const days = await matchesPerDay(sql);
		const today = new Date().toISOString().slice(0, 10);

		expect(days).toHaveLength(CHART_DAYS);
		expect(days.at(-1)).toEqual({ day: today, matches: 1 });
		expect(days.reduce((sum, day) => sum + day.matches, 0)).toBe(1);
	});
});
