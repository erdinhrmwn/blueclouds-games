import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { changeOwnPassword, createAdmin, login, logout, sessionAdmin } from './auth';

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

describe('changing your own password', () => {
	const signIn = async (username: string, password: string) => {
		const res = await login(sql, username, password, null);
		if (!res.ok) {
			throw new Error(`expected ${username} to sign in`);
		}

		return res;
	};

	test('needs the right current password and keeps only the session that changed it', async () => {
		await createAdmin(sql, 'changer', 'first long password');
		const here = await signIn('changer', 'first long password');
		const elsewhere = await signIn('changer', 'first long password');

		const wrong = { current: 'not my password', next: 'second long password' };
		expect(await changeOwnPassword(sql, here.admin, here.token, wrong, null)).toEqual({
			ok: false,
			reason: 'wrong_password'
		});
		expect(await failures('changer')).toBe(1);

		const right = { current: 'first long password', next: 'second long password' };
		expect(await changeOwnPassword(sql, here.admin, here.token, right, null)).toEqual({ ok: true });

		expect(await sessionAdmin(sql, here.token)).not.toBeNull();
		expect(await sessionAdmin(sql, elsewhere.token)).toBeNull();
		expect((await login(sql, 'changer', 'first long password', null)).ok).toBe(false);
		expect((await login(sql, 'changer', 'second long password', null)).ok).toBe(true);

		const [row] = await sql`
			SELECT count(*)::int AS n
			FROM admin_audit_events
			WHERE action = 'admin.password_change'
				AND target_admin_id = ${here.admin.id}`;
		expect(row.n).toBe(1);
	});

	test('refuses a short, an over-long or an unchanged new password', async () => {
		await createAdmin(sql, 'picky', 'picky long password');
		const session = await signIn('picky', 'picky long password');
		const change = (next: string) =>
			changeOwnPassword(
				sql,
				session.admin,
				session.token,
				{ current: 'picky long password', next },
				null
			);

		expect(await change('short')).toEqual({ ok: false, reason: 'too_short' });
		expect(await change('x'.repeat(257))).toEqual({ ok: false, reason: 'too_long' });
		expect(await change('picky long password')).toEqual({ ok: false, reason: 'unchanged' });
	});

	test('root can change its own password', async () => {
		const session = await signIn('root', 'correct horse battery');
		const input = { current: 'correct horse battery', next: 'a brand new root password' };

		expect(await changeOwnPassword(sql, session.admin, session.token, input, null)).toEqual({
			ok: true
		});
	});
});
