import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import {
	addAdmin,
	changeRole,
	disableAdmin,
	enableAdmin,
	listAdmins,
	resetAdminPassword
} from './admins';
import { type Admin, createAdmin, login } from './auth';

let sql: SQL;
let root: Admin;

beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	root = {
		id: await createAdmin(sql, 'root', 'correct horse battery'),
		username: 'root',
		role: 'owner'
	};
});
afterAll(() => sql.close());

const auditActions = async (targetId: string) => {
	const rows = await sql`
		SELECT action
		FROM admin_audit_events
		WHERE target_admin_id = ${targetId}
		ORDER BY id`;

	return rows.map((row: { action: string }) => row.action);
};

describe('admins', () => {
	test('adding one returns a working password once; a taken or bad username is refused', async () => {
		const added = await addAdmin(sql, root, { username: ' Ops ', role: 'admin' }, null);
		expect(added.ok).toBe(true);

		const password = added.ok ? added.password : '';
		const signedIn = await login(sql, 'ops', password, null);
		expect(signedIn.ok).toBe(true);

		expect(await addAdmin(sql, root, { username: 'ops', role: 'viewer' }, null)).toEqual({
			ok: false,
			reason: 'taken'
		});
		expect(await addAdmin(sql, root, { username: 'a b', role: 'admin' }, null)).toEqual({
			ok: false,
			reason: 'invalid'
		});

		const admins = await listAdmins(sql);
		expect(admins.map((admin) => admin.username)).toEqual(['root', 'ops']);
		expect(admins[1]).toMatchObject({ role: 'admin', sessions: 1, disabledAt: null });
	});

	test('disable signs them out; root and the owner itself stay enabled', async () => {
		const [ops] = (await listAdmins(sql)).filter((admin) => admin.username === 'ops');

		expect(await disableAdmin(sql, root, ops!.id, '10.0.0.1')).toBe(true);
		expect(await disableAdmin(sql, root, ops!.id, null)).toBe(false);
		expect(await disableAdmin(sql, root, root.id, null)).toBe(false);

		const [after] = (await listAdmins(sql)).filter((admin) => admin.username === 'ops');
		expect(after).toMatchObject({ sessions: 0 });
		expect(after!.disabledAt).not.toBeNull();

		expect(await enableAdmin(sql, root, ops!.id, null)).toBe(true);
		expect(await enableAdmin(sql, root, ops!.id, null)).toBe(false);
	});

	test('a role change is audited with from and to; root keeps owner', async () => {
		const [ops] = (await listAdmins(sql)).filter((admin) => admin.username === 'ops');

		expect(await changeRole(sql, root, ops!.id, 'viewer', null)).toBe(true);
		expect(await changeRole(sql, root, ops!.id, 'viewer', null)).toBe(false);
		expect(await changeRole(sql, root, root.id, 'viewer', null)).toBe(false);

		const [row] = await sql`
			SELECT detail
			FROM admin_audit_events
			WHERE action = 'admin.role_change'`;
		expect(row.detail).toEqual({ from: 'admin', to: 'viewer' });
	});

	test('a password reset replaces the old one and is audited with the target', async () => {
		const [ops] = (await listAdmins(sql)).filter((admin) => admin.username === 'ops');

		const password = await resetAdminPassword(sql, root, ops!.id, null);
		expect(password).toHaveLength(24);
		expect((await login(sql, 'ops', password!, null)).ok).toBe(true);
		expect(await resetAdminPassword(sql, root, root.id, null)).toBeNull();

		expect(await auditActions(ops!.id)).toEqual([
			'admin.create',
			'admin.disable',
			'admin.enable',
			'admin.role_change',
			'admin.password_reset'
		]);
	});
});
