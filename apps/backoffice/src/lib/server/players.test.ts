import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { type Admin, createAdmin } from './auth';
import {
	disablePlayer,
	enablePlayer,
	grantVip,
	playerDetail,
	type PlayerFilter,
	revokeVip,
	searchPlayers
} from './players';

let sql: SQL;
const everyone: PlayerFilter = { q: '', type: '', status: '' };
let admin: Admin;
const newPlayer = async (name: string) => {
	const [p] = await sql`INSERT INTO players (display_name) VALUES (${name}) RETURNING id`;
	await sql`INSERT INTO player_secrets (secret_hash, player_id) VALUES (${crypto.getRandomValues(new Uint8Array(32))}, ${p.id})`;
	return p.id as string;
};
beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	admin = {
		id: await createAdmin(sql, 'root', 'correct horse battery'),
		username: 'root',
		role: 'owner'
	};
});
afterAll(() => sql.close());

describe('players', () => {
	test('search matches part of a name or an exact id, and treats % and _ literally', async () => {
		const rina = await newPlayer('Rina');
		await newPlayer('Marina');
		await newPlayer('100%_win');
		expect(
			(await searchPlayers(sql, { ...everyone, q: 'rin' }, null)).map((p) => p.name).sort()
		).toEqual(['Marina', 'Rina']);
		expect((await searchPlayers(sql, { ...everyone, q: rina }, null)).map((p) => p.name)).toEqual([
			'Rina'
		]);
		expect((await searchPlayers(sql, { ...everyone, q: '%_' }, null)).map((p) => p.name)).toEqual([
			'100%_win'
		]);
		expect(await playerDetail(sql, 'not-a-uuid')).toBeNull();
	});

	test('filters by type and status', async () => {
		const bot = await newPlayer('Filter bot');
		const vip = await newPlayer('Filter vip');
		const gone = await newPlayer('Filter gone');
		await sql`UPDATE players SET is_bot = true WHERE id = ${bot}`;
		await sql`UPDATE players SET is_vip = true WHERE id = ${vip}`;
		await disablePlayer(sql, admin, gone, 'Test', null);

		const names = async (filter: Partial<PlayerFilter>) => {
			const rows = await searchPlayers(sql, { ...everyone, q: 'Filter', ...filter }, null);
			return rows.map((p) => p.name).sort();
		};

		expect(await names({ type: 'bot' })).toEqual(['Filter bot']);
		expect(await names({ type: 'vip' })).toEqual(['Filter vip']);
		expect(await names({ type: 'normal' })).toEqual(['Filter gone']);
		expect(await names({ status: 'disabled' })).toEqual(['Filter gone']);
		expect(await names({ type: 'normal', status: 'active' })).toEqual([]);
	});

	test('disable revokes every secret and writes one audit row, in one go', async () => {
		const id = await newPlayer('Cheater');
		expect(await disablePlayer(sql, admin, id, 'Abuse in chat', '10.0.0.2')).toBe(true);
		const [secret] = await sql`SELECT revoked_at FROM player_secrets WHERE player_id = ${id}`;
		expect(secret.revoked_at).not.toBeNull();
		const rows =
			await sql`SELECT action, detail, host(ip) AS ip FROM admin_audit_events WHERE player_id = ${id}`;
		expect(rows).toEqual([
			{
				action: 'player.disable',
				detail: { reason: 'Abuse in chat', secretsRevoked: 1 },
				ip: '10.0.0.2'
			}
		]);
		expect(await disablePlayer(sql, admin, id, 'again', null)).toBe(false); // already disabled
	});

	test('enable clears the status but keeps old secrets revoked', async () => {
		const id = await newPlayer('Back');
		await disablePlayer(sql, admin, id, 'Mistake', null);
		expect(await enablePlayer(sql, admin, id, null)).toBe(true);
		const detail = await playerDetail(sql, id);
		expect(detail?.player.disabledAt).toBeNull();
		const [secret] = await sql`SELECT revoked_at FROM player_secrets WHERE player_id = ${id}`;
		expect(secret.revoked_at).not.toBeNull();
		expect(await enablePlayer(sql, admin, id, null)).toBe(false);
	});
});

describe('accounts and VIP', () => {
	test('search finds a username; VIP can be granted and taken back, each audited once', async () => {
		const id = await newPlayer('Nia');
		await sql`UPDATE players SET username = 'nia_plays', password_hash = '$argon2id$v=19$test' WHERE id = ${id}`;
		expect((await searchPlayers(sql, { ...everyone, q: 'PLAYS' }, null)).map((p) => p.id)).toEqual([
			id
		]);
		expect(await grantVip(sql, admin, id, null)).toBe(true);
		expect(await grantVip(sql, admin, id, null)).toBe(false);
		expect((await playerDetail(sql, id))!.player).toMatchObject({
			username: 'nia_plays',
			isVip: true,
			isBot: false,
			isActive: true
		});
		expect(await revokeVip(sql, admin, id, null)).toBe(true);
		const actions =
			await sql`SELECT action FROM admin_audit_events WHERE player_id = ${id} ORDER BY id`;
		expect(actions.map((a: { action: string }) => a.action)).toEqual([
			'player.vip_grant',
			'player.vip_revoke'
		]);
	});
});
