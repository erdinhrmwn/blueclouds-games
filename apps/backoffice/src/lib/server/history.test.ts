import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase, room } from '../../../../platform/src/test-helpers';
import { createAdmin } from './auth';
import { listAudit } from './audit-log';
import { listMatches, matchDetail, matchGames, matchLog } from './matches';
import { disablePlayer } from './players';

let sql: SQL;
let rina: string;
const empty = { game: '', player: '', from: '', to: '', before: '' };
beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	[{ id: rina }] = await sql`INSERT INTO players (display_name) VALUES ('Rina') RETURNING id`;
	const match = async (id: string, ended: string, humanWins: boolean) => {
		const roomId = await room(sql, 'bust-31', 'ABCD');
		await sql`INSERT INTO matches (id, game_slug, room_id, rules_version, started_at, ended_at, body_hash)
		          VALUES (${id}, 'bust-31', ${roomId}, 1, ${ended}::timestamptz - interval '5 min', ${ended}, ${new Uint8Array(32)})`;
		await sql`INSERT INTO match_players (match_id, seat, player_id, bot_name, placement, score) VALUES
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
		expect(await listMatches(sql, { ...empty, from: '2026-11-10', to: '2026-11-10' })).toHaveLength(
			1
		);
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
		expect(m).toMatchObject({ gameName: 'Bust 31', scoreLabel: 'Lives left' });
		expect(m?.seats[0]?.score).toBe(2);
		expect(await matchGames(sql)).toEqual([
			{ slug: 'bust-31', name: 'Bust 31' },
			{ slug: 'cloudburst', name: 'Cloudburst' }
		]);
		expect(m?.seats.map((s) => [s.name, s.bot, s.placement])).toEqual([
			['Rina', false, 1],
			['Bot Rain', true, 2]
		]);
		// A table from before rooms were stored: open, opener unknown.
		expect(m).toMatchObject({
			roomCode: 'ABCD',
			tournamentId: null,
			openedByPlayerId: null,
			openedByAdmin: null
		});
	});

	test('detail shows the tournament, or who opened an open table', async () => {
		const admin = await createAdmin(sql, 'tables', 'correct horse battery');
		const [{ id: cup }] = await sql`
			INSERT INTO tournaments (game_slug, name, players_per_room, starts_at, registration_opens_at, registration_closes_at, created_by_admin_id)
			VALUES ('bust-31', 'Friday Cup', 2, now(), now() - interval '1 hour', now(), ${admin}) RETURNING id`;
		const [{ id: cupRoom }] =
			await sql`INSERT INTO rooms (game_slug, code, tournament_id) VALUES ('bust-31', 'CUP01', ${cup}) RETURNING id`;
		const [{ id: openRoom }] =
			await sql`INSERT INTO rooms (game_slug, code, created_by_player_id) VALUES ('bust-31', 'OPEN1', ${rina}) RETURNING id`;
		const played = async (id: string, roomId: string) => {
			await sql`INSERT INTO matches (id, game_slug, room_id, rules_version, started_at, ended_at, body_hash)
			          VALUES (${id}, 'bust-31', ${roomId}, 1, now() - interval '5 min', now(), ${new Uint8Array(32)})`;
			return matchDetail(sql, id);
		};
		expect(await played('01900000-0000-7000-8000-000000000003', cupRoom)).toMatchObject({
			roomCode: 'CUP01',
			tournamentId: cup,
			tournamentName: 'Friday Cup'
		});
		expect(await played('01900000-0000-7000-8000-000000000004', openRoom)).toMatchObject({
			roomCode: 'OPEN1',
			tournamentId: null,
			openedByPlayerId: rina,
			openedByPlayer: 'Rina'
		});
	});
});

test('audit log shows the admin and the target player by name', async () => {
	const id = await createAdmin(sql, 'root', 'correct horse battery');
	await disablePlayer(sql, { id, username: 'root' }, rina, 'Spam', '192.168.1.9');
	const [row] = await listAudit(sql, null);
	expect(row).toMatchObject({
		admin: 'root',
		action: 'player.disable',
		playerName: 'Rina',
		ip: '192.168.1.9',
		detail: { reason: 'Spam' }
	});
});
