import type { SQL } from 'bun';
import { isIP } from 'node:net';

export const ADMIN_ROLES = ['owner', 'admin', 'viewer'] as const;

/** owner: manages admins and everything else; admin: players and tournaments; viewer: reads only. */
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type Admin = { id: string; username: string; role: AdminRole };

/** The first admin. Always an owner, and never disabled (both enforced by the database). */
export const ROOT = 'root';

export const SESSION_COOKIE = 'bo_session';
export const SESSION_HOURS = 8;
export const USERNAME = /^[a-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 12;
/** Far above any real password; stops a huge body from being hashed. */
export const PASSWORD_MAX = 256;
/** 5 failed tries per username within 15 minutes lock that username for the rest of the window. */
const LOCKOUT = { tries: 5, minutes: 15 };
const SESSION_TOKEN_BYTES = 32;
/** A real session token is 43 characters; anything far longer is not worth hashing. */
const MAX_TOKEN_LENGTH = 100;

/** A client address fit for the audit log's inet column. */
export const auditIp = (address: string) => (isIP(address) ? address : null);

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest();

/** Same work for an unknown username as for a wrong password, so timing doesn't reveal which usernames exist. */
let dummyHash: Promise<string> | undefined;

/** Same list as the CHECK on admin_audit_events.action: a new action is added in both places. */
export type AuditAction =
	| 'login'
	| 'login_failed'
	| 'logout'
	| 'player.disable'
	| 'player.enable'
	| 'player.vip_grant'
	| 'player.vip_revoke'
	| 'player.coins_adjust'
	| 'tournament.create'
	| 'tournament.cancel'
	| 'tournament.register'
	| 'tournament.unregister'
	| 'tournament.distribute'
	| 'tournament.disqualify'
	| 'tournament.payout'
	| 'room.assign'
	| 'room.unassign'
	| 'room.kick'
	| 'room.terminate'
	| 'admin.create'
	| 'admin.disable'
	| 'admin.enable'
	| 'admin.password_reset'
	| 'admin.role_change'
	| 'admin.password_change'
	| 'game.maintenance_start'
	| 'game.maintenance_end';

export async function audit(
	sql: SQL,
	entry: {
		adminId: string | null;
		action: AuditAction;
		playerId?: string | null;
		tournamentId?: string | null;
		roomId?: string | null;
		targetAdminId?: string | null;
		detail?: Record<string, unknown>;
		ip: string | null;
	}
): Promise<void> {
	await sql`
		INSERT INTO admin_audit_events (
			admin_id,
			action,
			player_id,
			tournament_id,
			room_id,
			target_admin_id,
			detail,
			ip
		)
		VALUES (
			${entry.adminId},
			${entry.action},
			${entry.playerId ?? null},
			${entry.tournamentId ?? null},
			${entry.roomId ?? null},
			${entry.targetAdminId ?? null},
			${entry.detail ?? {}},
			${entry.ip}::inet
		)`;
}

/** Too many recent failed sign-ins (or wrong current passwords) for this username. */
async function isLockedOut(sql: SQL, username: string): Promise<boolean> {
	const [{ failures }] = await sql`
		SELECT count(*)::int AS failures
		FROM admin_audit_events
		WHERE action = 'login_failed'
			AND detail->>'username' = ${username}
			AND created_at > now() - make_interval(mins => ${LOCKOUT.minutes})`;

	return failures >= LOCKOUT.tries;
}

export type LoginResult =
	{ ok: true; token: string; admin: Admin } | { ok: false; reason: 'invalid' | 'locked' };

export async function login(
	sql: SQL,
	username: string,
	password: string,
	ip: string | null
): Promise<LoginResult> {
	const name = username.trim().toLowerCase();
	if (await isLockedOut(sql, name)) {
		return { ok: false, reason: 'locked' };
	}

	const [row] = await sql`
		SELECT id, username, role, password_hash
		FROM admins
		WHERE username = ${name} AND disabled_at IS NULL`;

	dummyHash ??= Bun.password.hash('not-a-real-password');
	const hashToCheck = row?.password_hash ?? (await dummyHash);
	const valid = await Bun.password.verify(password, hashToCheck);

	if (!row || !valid) {
		await audit(sql, {
			adminId: row?.id ?? null,
			action: 'login_failed',
			detail: { username: name },
			ip
		});
		return { ok: false, reason: 'invalid' };
	}

	const tokenBytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
	const token = Buffer.from(tokenBytes).toString('base64url');

	await sql.begin(async (tx) => {
		await tx`
			DELETE FROM admin_sessions
			WHERE expires_at < now()`;
		await tx`
			INSERT INTO admin_sessions (token_hash, admin_id, expires_at)
			VALUES (${sha256(token)}, ${row.id}, now() + make_interval(hours => ${SESSION_HOURS}))`;
		await audit(tx, { adminId: row.id, action: 'login', ip });
	});

	return { ok: true, token, admin: { id: row.id, username: row.username, role: row.role } };
}

/** The admin a session cookie belongs to, or null if it is unknown, expired or the admin was disabled. */
export async function sessionAdmin(sql: SQL, token: string | undefined): Promise<Admin | null> {
	if (!token || token.length > MAX_TOKEN_LENGTH) {
		return null;
	}

	const [row] = await sql`
		SELECT a.id, a.username, a.role
		FROM admin_sessions s
		JOIN admins a ON a.id = s.admin_id
		WHERE s.token_hash = ${sha256(token)}
			AND s.expires_at > now()
			AND a.disabled_at IS NULL`;

	if (!row) {
		return null;
	}

	return { id: row.id, username: row.username, role: row.role };
}

export async function logout(
	sql: SQL,
	token: string,
	admin: Admin,
	ip: string | null
): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`
			DELETE FROM admin_sessions
			WHERE token_hash = ${sha256(token)}`;
		await audit(tx, { adminId: admin.id, action: 'logout', ip });
	});
}

export type ChangePasswordResult =
	| { ok: true }
	| { ok: false; reason: 'wrong_password' | 'locked' | 'too_short' | 'too_long' | 'unchanged' };

/**
 * An admin changes their own password, root included. The current one must be right: a wrong one counts as a failed
 * sign-in, so guessing it from a borrowed session hits the same lockout. Every other session of theirs ends; the one
 * making the change (`token`) stays signed in.
 */
export async function changeOwnPassword(
	sql: SQL,
	admin: Admin,
	token: string,
	input: { current: string; next: string },
	ip: string | null
): Promise<ChangePasswordResult> {
	if (input.next.length < PASSWORD_MIN) {
		return { ok: false, reason: 'too_short' };
	}

	if (input.next.length > PASSWORD_MAX) {
		return { ok: false, reason: 'too_long' };
	}

	if (input.next === input.current) {
		return { ok: false, reason: 'unchanged' };
	}

	if (await isLockedOut(sql, admin.username)) {
		return { ok: false, reason: 'locked' };
	}

	const [row] = await sql`
		SELECT password_hash
		FROM admins
		WHERE id = ${admin.id}
			AND disabled_at IS NULL`;

	const currentIsRight = !!row && (await Bun.password.verify(input.current, row.password_hash));
	if (!currentIsRight) {
		await audit(sql, {
			adminId: admin.id,
			action: 'login_failed',
			detail: { username: admin.username },
			ip
		});
		return { ok: false, reason: 'wrong_password' };
	}

	const hash = await Bun.password.hash(input.next);

	await sql.begin(async (tx) => {
		await tx`
			UPDATE admins
			SET password_hash = ${hash}
			WHERE id = ${admin.id}`;
		await tx`
			DELETE FROM admin_sessions
			WHERE admin_id = ${admin.id}
				AND token_hash <> ${sha256(token)}`;
		await audit(tx, {
			adminId: admin.id,
			action: 'admin.password_change',
			targetAdminId: admin.id,
			ip
		});
	});

	return { ok: true };
}

/** Used by the admin:create script. Returns the new admin's id. */
export async function createAdmin(sql: SQL, username: string, password: string): Promise<string> {
	if (!USERNAME.test(username)) {
		throw new Error('Username must be 3-32 characters: a-z, 0-9, _ . -');
	}

	if (password.length < PASSWORD_MIN) {
		throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
	}

	const hash = await Bun.password.hash(password); // argon2id

	const role: AdminRole = username === ROOT ? 'owner' : 'admin';

	const [row] = await sql`
		INSERT INTO admins (username, password_hash, role)
		VALUES (${username}, ${hash}, ${role})
		ON CONFLICT (username) DO NOTHING
		RETURNING id`;

	if (!row) {
		throw new Error(`Admin "${username}" already exists.`);
	}

	return row.id;
}
