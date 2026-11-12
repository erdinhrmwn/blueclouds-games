import type { SQL } from 'bun';
import type { Admin, AdminRole } from './auth.ts';
import { ADMIN_ROLES, audit, ROOT, USERNAME } from './auth.ts';
import { isUuid } from './players.ts';

/** 18 random bytes: a 24-character password, shown once to the owner. */
const PASSWORD_BYTES = 18;

/** Owners manage admins. */
export const isOwner = (admin: Admin | null) => admin?.role === 'owner';

/** Viewers only read: every form post is refused for them. */
export const canEdit = (admin: Admin | null) => !!admin && admin.role !== 'viewer';

export const isAdminRole = (value: string): value is AdminRole =>
	ADMIN_ROLES.some((role) => role === value);

export type AdminRow = {
	id: string;
	username: string;
	role: AdminRole;
	createdAt: Date;
	disabledAt: Date | null;
	lastSignInAt: Date | null;
	/** Sessions that haven't expired. */
	sessions: number;
};

export async function listAdmins(sql: SQL): Promise<AdminRow[]> {
	const rows = await sql`
		SELECT
			a.id,
			a.username,
			a.role,
			a.created_at AS "createdAt",
			a.disabled_at AS "disabledAt",
			(
				SELECT max(e.created_at)
				FROM admin_audit_events e
				WHERE e.admin_id = a.id
					AND e.action = 'login'
			) AS "lastSignInAt",
			(
				SELECT count(*)::int
				FROM admin_sessions s
				WHERE s.admin_id = a.id
					AND s.expires_at > now()
			) AS sessions
		FROM admins a
		ORDER BY a.id`;

	return rows as AdminRow[];
}

function newPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_BYTES));

	return Buffer.from(bytes).toString('base64url');
}

/** Whether the owner may change this admin: never root, never themselves. */
const changeable = (owner: Admin, id: string) => isUuid(id) && id !== owner.id;

export type AddAdminResult =
	{ ok: true; password: string } | { ok: false; reason: 'invalid' | 'taken' };

/** Adds an admin with a generated password, which is returned once and stored only as a hash. */
export async function addAdmin(
	sql: SQL,
	owner: Admin,
	input: { username: string; role: AdminRole },
	ip: string | null
): Promise<AddAdminResult> {
	const name = input.username.trim().toLowerCase();
	if (!USERNAME.test(name) || name === ROOT) return { ok: false, reason: 'invalid' };

	const password = newPassword();
	const hash = await Bun.password.hash(password);

	return sql.begin(async (tx) => {
		const [row] = await tx`
			INSERT INTO admins (username, password_hash, role)
			VALUES (${name}, ${hash}, ${input.role})
			ON CONFLICT (username) DO NOTHING
			RETURNING id`;

		if (!row) return { ok: false, reason: 'taken' } as const;

		await audit(tx, {
			adminId: owner.id,
			action: 'admin.create',
			targetAdminId: row.id,
			detail: { role: input.role },
			ip
		});

		return { ok: true, password } as const;
	});
}

/** Gives another admin a new role. Returns false for root, for the owner themselves, or if nothing changed. */
export async function changeRole(
	sql: SQL,
	owner: Admin,
	id: string,
	role: AdminRole,
	ip: string | null
): Promise<boolean> {
	if (!changeable(owner, id)) return false;

	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE admins target
			SET role = ${role}
			FROM admins previous
			WHERE previous.id = target.id
				AND target.id = ${id}
				AND target.username <> ${ROOT}
				AND target.role <> ${role}
			RETURNING previous.role AS "from"`;

		if (!row) return false;

		await audit(tx, {
			adminId: owner.id,
			action: 'admin.role_change',
			targetAdminId: id,
			detail: { from: row.from, to: role },
			ip
		});

		return true;
	});
}

/**
 * Disables another admin and signs them out everywhere. Returns false for root, for the owner themselves, or if
 * the admin doesn't exist or is already disabled.
 */
export async function disableAdmin(
	sql: SQL,
	owner: Admin,
	id: string,
	ip: string | null
): Promise<boolean> {
	if (!changeable(owner, id)) return false;

	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE admins
			SET disabled_at = now()
			WHERE id = ${id}
				AND username <> ${ROOT}
				AND disabled_at IS NULL
			RETURNING id`;

		if (!row) return false;

		await tx`DELETE FROM admin_sessions WHERE admin_id = ${id}`;
		await audit(tx, { adminId: owner.id, action: 'admin.disable', targetAdminId: id, ip });

		return true;
	});
}

/** Lets a disabled admin sign in again with their old password. Returns false if they weren't disabled. */
export async function enableAdmin(
	sql: SQL,
	owner: Admin,
	id: string,
	ip: string | null
): Promise<boolean> {
	if (!isUuid(id)) return false;

	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE admins
			SET disabled_at = NULL
			WHERE id = ${id}
				AND disabled_at IS NOT NULL
			RETURNING id`;

		if (!row) return false;

		await audit(tx, { adminId: owner.id, action: 'admin.enable', targetAdminId: id, ip });

		return true;
	});
}

/**
 * Gives another admin a new generated password and signs them out everywhere. Returns the password once, or null
 * for root (root changes its own password on the server), for the owner themselves, or an unknown admin.
 */
export async function resetAdminPassword(
	sql: SQL,
	owner: Admin,
	id: string,
	ip: string | null
): Promise<string | null> {
	if (!changeable(owner, id)) return null;

	const password = newPassword();
	const hash = await Bun.password.hash(password);

	return sql.begin(async (tx) => {
		const [row] = await tx`
			UPDATE admins
			SET password_hash = ${hash}
			WHERE id = ${id}
				AND username <> ${ROOT}
			RETURNING id`;

		if (!row) return null;

		await tx`DELETE FROM admin_sessions WHERE admin_id = ${id}`;
		await audit(tx, { adminId: owner.id, action: 'admin.password_reset', targetAdminId: id, ip });

		return password;
	});
}
