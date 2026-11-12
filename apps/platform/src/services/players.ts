import type { SQL } from "bun";
import { ApiError } from "../lib/http";
import type { Signer } from "../lib/play-tokens";
import { hashSecret, newSecret, SECRET_PATTERN } from "../lib/secrets";
import { deleteGuestIfUnused } from "./guests";

/** A guest has a generated `guest_…` username and no password: it exists only in the browser that holds its secret. */
export type Player = {
	id: string;
	name: string;
	username: string | null;
	guest: boolean;
	createdAt: string;
};

export type PlayerRow = {
	id: string;
	display_name: string;
	username: string | null;
	is_guest: boolean;
	created_at: Date;
	disabled_at: Date | null;
};

/** A player as the API returns it, with the secret when one was just made for this device. */
type SignedIn = { player: Player; playerSecret?: string };

const PLAYER_COLUMNS = (sql: SQL) =>
	sql`p.id, p.display_name, p.username, p.is_guest, p.created_at, p.disabled_at`;

const RETURNING = (sql: SQL) =>
	sql`RETURNING id, display_name, username, is_guest, created_at, disabled_at`;

export const toPlayer = (row: PlayerRow): Player => ({
	id: row.id,
	name: row.display_name,
	username: row.username,
	guest: row.is_guest,
	createdAt: row.created_at.toISOString(),
});

/** 5 wrong passwords for one username within 15 minutes lock it for the rest of that window, like admin sign-in. */
const LOCKOUT = { tries: 5, windowMs: 15 * 60_000 };

/** Tries before giving up on a free guest number (6 digits: a clash is rare, a few in a row means something else). */
const GUEST_NUMBER_TRIES = 5;

/** A random 6-digit number, 100000-999999. */
function guestNumber(): string {
	const [random] = crypto.getRandomValues(new Uint32Array(1));
	return String(100_000 + (random! % 900_000));
}

/** Above this many tracked usernames, expired windows are swept so the map cannot grow forever. */
const FAILURES_SWEEP_AT = 10_000;

/**
 * Wrong passwords per username.
 * ponytail: counted in this process, like rateLimit. With more platform instances, move it to DragonflyDB.
 */
const failures = new Map<string, { count: number; resetAt: number }>();

function isLocked(username: string): boolean {
	const entry = failures.get(username);
	if (!entry) return false;

	return entry.resetAt > Date.now() && entry.count >= LOCKOUT.tries;
}

function noteFailure(username: string): void {
	const now = Date.now();
	if (failures.size > FAILURES_SWEEP_AT) {
		for (const [name, entry] of failures) {
			if (entry.resetAt <= now) failures.delete(name);
		}
	}

	const entry = failures.get(username);
	if (!entry || entry.resetAt <= now) {
		failures.set(username, { count: 1, resetAt: now + LOCKOUT.windowMs });
	} else {
		entry.count += 1;
	}
}

/** Same work for an unknown username as for a wrong password, so timing doesn't reveal which usernames exist. */
let dummyHash: Promise<string> | undefined;

const isUniqueViolation = (err: unknown) => (err as { errno?: string })?.errno === "23505";

/**
 * The player behind a player secret: null when there is none or it was revoked.
 * Throws 403 for a disabled player: the backoffice revokes their secrets too, and they should be told why.
 */
export async function findBySecret(sql: SQL, secret: string | null): Promise<PlayerRow | null> {
	if (!secret || !SECRET_PATTERN.test(secret)) return null;

	const [row] = (await sql`
		SELECT ${PLAYER_COLUMNS(sql)}, s.revoked_at
		FROM player_secrets s
		JOIN players p ON p.id = s.player_id
		WHERE s.secret_hash = ${hashSecret(secret)}`) as (PlayerRow & { revoked_at: Date | null })[];

	if (row?.disabled_at) throw new ApiError("forbidden", 403, "This player has been disabled.");
	if (!row || row.revoked_at) return null;

	return row;
}

/** New guest player, named "Guest 482193" with username "guest_482193" unless it brings a name. */
export async function createGuest(sql: SQL, name: string | undefined): Promise<Required<SignedIn>> {
	const secret = newSecret();
	for (let i = 0; i < GUEST_NUMBER_TRIES; i++) {
		const number = guestNumber();
		const displayName = name ?? `Guest ${number}`;
		const username = `guest_${number}`;

		try {
			const row = await sql.begin(async (tx) => {
				const [player] = await tx`
					INSERT INTO players (display_name, username)
					VALUES (${displayName}, ${username})
					${RETURNING(tx)}`;
				await tx`
					INSERT INTO player_secrets (secret_hash, player_id)
					VALUES (${hashSecret(secret)}, ${player.id})`;

				return player;
			});

			return { player: toPlayer(row), playerSecret: secret };
		} catch (err) {
			if (!isUniqueViolation(err)) throw err; // that number is taken: draw another
		}
	}
	throw new ApiError("internal", 500, "Could not make a guest right now. Try again.");
}

/**
 * Registers a username and password. A current guest becomes the account (history and secret stay, no new
 * secret returned); without one, a new player is made and its secret returned.
 */
export async function register(
	sql: SQL,
	current: PlayerRow | null,
	input: { name: string; username: string; password: string },
): Promise<SignedIn> {
	const { name, username, password } = input;
	if (current && !current.is_guest) {
		throw new ApiError("conflict", 409, "You already have an account. Log out first.");
	}

	const passwordHash = await Bun.password.hash(password); // argon2id
	try {
		if (current) {
			const [row] = await sql`
				UPDATE players
				SET display_name = ${name}, username = ${username}, password_hash = ${passwordHash}
				WHERE id = ${current.id} AND is_guest
				${RETURNING(sql)}`;

			if (!row) throw new ApiError("conflict", 409, "You already have an account. Log out first.");
			return { player: toPlayer(row as PlayerRow) };
		}

		const secret = newSecret();
		const row = await sql.begin(async (tx) => {
			const [player] = await tx`
				INSERT INTO players (display_name, username, password_hash)
				VALUES (${name}, ${username}, ${passwordHash})
				${RETURNING(tx)}`;
			await tx`
				INSERT INTO player_secrets (secret_hash, player_id)
				VALUES (${hashSecret(secret)}, ${player.id})`;

			return player as PlayerRow;
		});

		return { player: toPlayer(row), playerSecret: secret };
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new ApiError("conflict", 409, "Some fields are invalid.", {
				username: "That username is taken.",
			});
		}

		throw err;
	}
}

/** Signs in on this device: a new secret for this browser, the player's other devices stay signed in. */
export async function login(
	sql: SQL,
	username: string,
	password: string,
): Promise<Required<SignedIn>> {
	if (isLocked(username)) {
		throw new ApiError("rate_limited", 429, "Too many wrong passwords. Try again in 15 minutes.");
	}

	const [row] = (await sql`
		SELECT id, display_name, username, is_guest, created_at, disabled_at, password_hash
		FROM players
		WHERE username = ${username}`) as (PlayerRow & { password_hash: string | null })[];

	dummyHash ??= Bun.password.hash("not-a-real-password");
	const hashToCheck = row?.password_hash ?? (await dummyHash);
	const valid = await Bun.password.verify(password, hashToCheck);

	if (!row || !valid) {
		noteFailure(username);
		throw new ApiError("unauthenticated", 401, "Wrong username or password.");
	}

	failures.delete(username);
	if (row.disabled_at) throw new ApiError("forbidden", 403, "This player has been disabled.");

	const secret = newSecret();
	await sql`
		INSERT INTO player_secrets (secret_hash, player_id)
		VALUES (${hashSecret(secret)}, ${row.id})`;

	return { player: toPlayer(row), playerSecret: secret };
}

/** Signs this device out: its secret stops working. A guest that never played is deleted, since it can't come back. */
export async function logout(sql: SQL, player: Player, secret: string): Promise<void> {
	await sql`UPDATE player_secrets SET revoked_at = now() WHERE secret_hash = ${hashSecret(secret)}`;

	if (player.guest) await deleteGuestIfUnused(sql, player.id);
}

/** Counts as being seen, at most one write an hour, so the guest sweep spares the player. */
export async function noteSeen(sql: SQL, playerId: string): Promise<void> {
	await sql`
		UPDATE players
		SET last_seen_at = now()
		WHERE id = ${playerId} AND last_seen_at < now() - interval '1 hour'`;
}

export async function rename(sql: SQL, playerId: string, name: string): Promise<Player> {
	const [row] = await sql`
		UPDATE players
		SET display_name = ${name}
		WHERE id = ${playerId}
		${RETURNING(sql)}`;

	return toPlayer(row);
}

/** Short-lived token for connecting to a room actor. Counts as the player being seen. */
export async function issuePlayToken(sql: SQL, signer: Signer, player: Player) {
	await sql`UPDATE players SET last_seen_at = now() WHERE id = ${player.id}`;

	return signer.sign(player);
}
