import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { type Admin, createAdmin } from './auth';
import { disablePlayer, enablePlayer, playerDetail, searchPlayers } from './players';

let sql: SQL;
let admin: Admin;
const newPlayer = async (name: string) => {
	const [p] = await sql`INSERT INTO players (display_name) VALUES (${name}) RETURNING id`;
	await sql`INSERT INTO player_secrets (secret_hash, player_id) VALUES (${crypto.getRandomValues(new Uint8Array(32))}, ${p.id})`;
	return p.id as string;
};
beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	admin = { id: await createAdmin(sql, 'root', 'correct horse battery'), username: 'root' };
});
afterAll(() => sql.close());

describe('players', () => {
	test('search matches part of a name or an exact id, and treats % and _ literally', async () => {
		const rina = await newPlayer('Rina');
		await newPlayer('Marina');
		await newPlayer('100%_win');
		expect((await searchPlayers(sql, 'rin', null)).map((p) => p.name).sort()).toEqual(['Marina', 'Rina']);
		expect((await searchPlayers(sql, rina, null)).map((p) => p.name)).toEqual(['Rina']);
		expect((await searchPlayers(sql, '%_', null)).map((p) => p.name)).toEqual(['100%_win']);
		expect(await playerDetail(sql, 'not-a-uuid')).toBeNull();
	});

	test('disable revokes every secret and writes one audit row, in one go', async () => {
		const id = await newPlayer('Cheater');
		expect(await disablePlayer(sql, admin, id, 'Abuse in chat', '10.0.0.2')).toBe(true);
		const [secret] = await sql`SELECT revoked_at FROM player_secrets WHERE player_id = ${id}`;
		expect(secret.revoked_at).not.toBeNull();
		const rows = await sql`SELECT action, detail, host(ip) AS ip FROM admin_audit WHERE target_id = ${id}`;
		expect(rows).toEqual([{ action: 'player.disable', detail: { reason: 'Abuse in chat', secretsRevoked: 1 }, ip: '10.0.0.2' }]);
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
