import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { createAdmin } from './auth';
import { listAudit } from './audit-log';
import { listMatches, matchDetail, matchLog } from './matches';
import { disablePlayer } from './players';

let sql: SQL;
let rina: string;
const empty = { game: '', player: '', from: '', to: '', before: '' };
beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	[{ id: rina }] = await sql`INSERT INTO players (display_name) VALUES ('Rina') RETURNING id`;
	const match = async (id: string, ended: string, humanWins: boolean) => {
		await sql`INSERT INTO matches (id, game_slug, room_code, rules_version, started_at, ended_at, body_hash)
		          VALUES (${id}, 'bust-31', 'ABCD', 1, ${ended}::timestamptz - interval '5 min', ${ended}, '\\x00')`;
		await sql`INSERT INTO match_players (match_id, seat, player_id, bot_name, placement, lives_left) VALUES
		          (${id}, 0, ${rina}, NULL, ${humanWins ? 1 : 2}, ${humanWins ? 2 : 0}),
		          (${id}, 1, NULL, 'Bot Rain', ${humanWins ? 2 : 1}, ${humanWins ? 0 : 1})`;
	};
	await match('01900000-0000-7000-8000-000000000001', '2026-11-09T10:00:00Z', true);
	await match('01900000-0000-7000-8000-000000000002', '2026-11-10T23:59:00Z', false);
});
afterAll(() => sql.close());

describe('matches', () => {
	test('lists newest first with the winner, and filters by player and UTC day', async () => {
		const all = await listMatches(sql, empty);
		expect(all.map((m) => m.winner)).toEqual(['Bot Rain', 'Rina']);
		expect(all[0]!.players).toBe(2);
		expect(await listMatches(sql, { ...empty, to: '2026-11-09' })).toHaveLength(1);
		expect(await listMatches(sql, { ...empty, from: '2026-11-10', to: '2026-11-10' })).toHaveLength(1);
		expect(await listMatches(sql, { ...empty, player: rina, game: 'other' })).toHaveLength(0);
		expect(await listMatches(sql, { ...empty, from: 'garbage' })).toHaveLength(2);
	});

	test('move log: as stored, or null for an old match', async () => {
		const id = '01900000-0000-7000-8000-000000000001';
		const events = [{ seq: 0, t: 0, type: 'finished', data: { winner: 0 } }];
		await sql`INSERT INTO match_logs (match_id, log_version, event_count, events) VALUES (${id}, 1, 1, ${JSON.stringify(events)}::text::jsonb)`;
		expect(await matchLog(sql, id)).toEqual({ logVersion: 1, events });
		expect(await matchLog(sql, '01900000-0000-7000-8000-000000000002')).toBeNull();
		expect(await matchLog(sql, 'nope')).toBeNull();
	});

	test('detail lists seats by placement', async () => {
		const m = await matchDetail(sql, '01900000-0000-7000-8000-000000000001');
		expect(m?.seats.map((s) => [s.name, s.bot, s.placement])).toEqual([
			['Rina', false, 1],
			['Bot Rain', true, 2]
		]);
	});
});

test('audit log shows the admin and the target player by name', async () => {
	const id = await createAdmin(sql, 'root', 'correct horse battery');
	await disablePlayer(sql, { id, username: 'root' }, rina, 'Spam', '192.168.1.9');
	const [row] = await listAudit(sql, null);
	expect(row).toMatchObject({ admin: 'root', action: 'player.disable', targetName: 'Rina', ip: '192.168.1.9', detail: { reason: 'Spam' } });
});
