import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { createAdmin, login, logout, sessionAdmin } from './auth';

// Runs against the platform's test database (DATABASE_TEST_NAME), migrated fresh.
let sql: SQL;
beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	await createAdmin(sql, 'root', 'correct horse battery');
});
afterAll(() => sql.close());

const failures = async (username: string) =>
	(
		await sql`SELECT count(*)::int AS n FROM admin_audit_events WHERE action = 'login_failed' AND detail->>'username' = ${username}`
	)[0].n;

describe('admin login', () => {
	test('a wrong password fails and writes a login_failed audit row', async () => {
		expect(await login(sql, 'root', 'wrong password!', '10.0.0.1')).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(await failures('root')).toBe(1);
	});

	test('the right password gives a session that logout ends', async () => {
		const res = await login(sql, 'Root ', 'correct horse battery', null);
		if (!res.ok) throw new Error('expected login to work');
		expect(await sessionAdmin(sql, res.token)).toEqual({
			id: res.admin.id,
			username: 'root',
			role: 'owner'
		});
		await logout(sql, res.token, res.admin, null);
		expect(await sessionAdmin(sql, res.token)).toBeNull();
	});

	test('5 failures within 15 minutes lock the username, even with the right password', async () => {
		await createAdmin(sql, 'ops', 'another long password');
		for (let i = 0; i < 5; i++) await login(sql, 'ops', 'nope', null);
		expect(await login(sql, 'ops', 'another long password', null)).toEqual({
			ok: false,
			reason: 'locked'
		});
	});

	test('an unknown username fails the same way', async () => {
		expect(await login(sql, 'ghost', 'whatever', null)).toEqual({ ok: false, reason: 'invalid' });
	});

	test('a disabled admin cannot sign in or keep a session', async () => {
		const id = await createAdmin(sql, 'temp', 'temporary password');
		const res = await login(sql, 'temp', 'temporary password', null);
		await sql`UPDATE admins SET disabled_at = now() WHERE id = ${id}`;
		expect(res.ok && (await sessionAdmin(sql, res.token))).toBeNull();
		expect(await login(sql, 'temp', 'temporary password', null)).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	test('createAdmin rejects short passwords, bad usernames and duplicates', async () => {
		expect(createAdmin(sql, 'shorty', 'short')).rejects.toThrow('at least 12');
		expect(createAdmin(sql, 'Bad Name', 'long enough password')).rejects.toThrow('Username');
		expect(createAdmin(sql, 'root', 'long enough password')).rejects.toThrow('already exists');
	});
});
