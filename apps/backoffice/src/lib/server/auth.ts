import type { SQL } from 'bun';
import { isIP } from 'node:net';

export type Admin = { id: string; username: string };

export const SESSION_COOKIE = 'bo_session';
export const SESSION_HOURS = 8;
export const USERNAME = /^[a-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 12;
/** 5 failed tries per username within 15 minutes lock that username for the rest of the window. */
const LOCKOUT = { tries: 5, minutes: 15 };

/** A client address fit for the audit log's inet column. */
export const auditIp = (address: string) => (isIP(address) ? address : null);

const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest();

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
	| 'tournament.create'
	| 'tournament.cancel'
	| 'tournament.register'
	| 'tournament.unregister'
	| 'tournament.distribute'
	| 'room.assign'
	| 'room.unassign';

export async function audit(
	sql: SQL,
	entry: {
		adminId: string | null;
		action: AuditAction;
		playerId?: string | null;
		tournamentId?: string | null;
		roomId?: string | null;
		detail?: Record<string, unknown>;
		ip: string | null;
	}
): Promise<void> {
	await sql`
		INSERT INTO admin_audit_events (admin_id, action, player_id, tournament_id, room_id, detail, ip)
		VALUES (${entry.adminId}, ${entry.action}, ${entry.playerId ?? null}, ${entry.tournamentId ?? null}, ${entry.roomId ?? null},
		        ${entry.detail ?? {}}, ${entry.ip}::inet)`;
}

export type LoginResult = { ok: true; token: string; admin: Admin } | { ok: false; reason: 'invalid' | 'locked' };

export async function login(sql: SQL, username: string, password: string, ip: string | null): Promise<LoginResult> {
	const name = username.trim().toLowerCase();
	const [{ failures }] = await sql`
		SELECT count(*)::int AS failures FROM admin_audit_events
		WHERE action = 'login_failed' AND detail->>'username' = ${name}
		  AND created_at > now() - make_interval(mins => ${LOCKOUT.minutes})`;
	if (failures >= LOCKOUT.tries) return { ok: false, reason: 'locked' };

	const [row] = await sql`SELECT id, username, password_hash FROM admins WHERE username = ${name} AND disabled_at IS NULL`;
	dummyHash ??= Bun.password.hash('not-a-real-password');
	const valid = await Bun.password.verify(password, row?.password_hash ?? (await dummyHash));
	if (!row || !valid) {
		await audit(sql, { adminId: row?.id ?? null, action: 'login_failed', detail: { username: name }, ip });
		return { ok: false, reason: 'invalid' };
	}

	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	await sql.begin(async (tx) => {
		await tx`DELETE FROM admin_sessions WHERE expires_at < now()`;
		await tx`
			INSERT INTO admin_sessions (token_hash, admin_id, expires_at)
			VALUES (${sha256(token)}, ${row.id}, now() + make_interval(hours => ${SESSION_HOURS}))`;
		await audit(tx, { adminId: row.id, action: 'login', ip });
	});
	return { ok: true, token, admin: { id: row.id, username: row.username } };
}

/** The admin a session cookie belongs to, or null if it is unknown, expired or the admin was disabled. */
export async function sessionAdmin(sql: SQL, token: string | undefined): Promise<Admin | null> {
	if (!token || token.length > 100) return null;
	const [row] = await sql`
		SELECT a.id, a.username FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
		WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now() AND a.disabled_at IS NULL`;
	return row ? { id: row.id, username: row.username } : null;
}

export async function logout(sql: SQL, token: string, admin: Admin, ip: string | null): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`DELETE FROM admin_sessions WHERE token_hash = ${sha256(token)}`;
		await audit(tx, { adminId: admin.id, action: 'logout', ip });
	});
}

/** Used by the admin:create script. Returns the new admin's id. */
export async function createAdmin(sql: SQL, username: string, password: string): Promise<string> {
	if (!USERNAME.test(username)) throw new Error('Username must be 3-32 characters: a-z, 0-9, _ . -');
	if (password.length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
	const hash = await Bun.password.hash(password); // argon2id
	const [row] = await sql`INSERT INTO admins (username, password_hash) VALUES (${username}, ${hash}) ON CONFLICT (username) DO NOTHING RETURNING id`;
	if (!row) throw new Error(`Admin "${username}" already exists.`);
	return row.id;
}
