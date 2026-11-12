import { error, json, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/env';
import { PLATFORM_URL } from '$app/env/private';

/**
 * The game's server side of the platform: the browser calls our /api routes, and this module
 * calls the platform over the internal network. The player secret lives only in an httpOnly cookie.
 */

const SECRET_COOKIE = 'player_secret';
const SECRET_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers keep a cookie
const TIMEOUT_MS = 5_000;

type Envelope<T> =
	| { ok: true; data: T }
	| { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };
export class PlatformError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly fields?: Record<string, string>
	) {
		super(message);
	}
}

async function call<T>(
	event: RequestEvent,
	path: string,
	init: { method: string; secret?: string; body?: unknown }
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${PLATFORM_URL}/v1${path}`, {
			method: init.method,
			headers: {
				'Content-Type': 'application/json',
				// The platform rate-limits guests by IP; it trusts this header because only we can reach it.
				'X-Forwarded-For': event.getClientAddress(),
				...(init.secret ? { Authorization: `Bearer ${init.secret}` } : {})
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (err) {
		console.error('platform unreachable', path, String(err));
		throw new PlatformError(503, 'unavailable', 'The game server is busy. Try again in a moment.');
	}
	const body = (await res.json().catch(() => null)) as Envelope<T> | null;
	if (body?.ok) return body.data;
	throw new PlatformError(
		res.status,
		body?.error.code ?? 'internal',
		body?.error.message ?? 'Something went wrong. Try again.',
		body?.error.fields
	);
}

const secretOf = (cookies: Cookies) => cookies.get(SECRET_COOKIE);
const saveSecret = (cookies: Cookies, secret: string) =>
	cookies.set(SECRET_COOKIE, secret, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: SECRET_MAX_AGE
	});

/** "Play as guest": a new guest for this browser. The platform picks the name and username; a guest can't choose them. */
export async function startGuest(event: RequestEvent): Promise<Me> {
	const { player, playerSecret } = await call<{ player: Me; playerSecret: string }>(
		event,
		'/players/guest',
		{ method: 'POST', body: {} }
	);
	saveSecret(event.cookies, playerSecret);
	return { name: player.name, username: player.username, guest: player.guest };
}

// A secret the platform no longer knows (e.g. a reset database).
const lost = (e: unknown) => e instanceof PlatformError && e.code === 'unauthenticated';
/** Every page needs a player (see +layout.server.ts), so a missing one here means the session ended. */
const ended = () =>
	new PlatformError(401, 'unauthenticated', 'Your session ended. Reload the page to continue.');
function secretOrEnded(cookies: Cookies): string {
	const secret = secretOf(cookies);
	if (!secret) throw ended();
	return secret;
}

export type Me = { name: string; username: string | null; guest: boolean };

/**
 * Who this browser plays as, asked from the platform on every page load so the page never trusts a stale copy.
 * Null for a new visitor, a secret the platform forgot, or a disabled player.
 */
export async function whoAmI(event: RequestEvent): Promise<Me | null> {
	const secret = secretOf(event.cookies);
	if (!secret) return null;
	try {
		const { player } = await call<{ player: Me }>(event, '/players/me', { method: 'GET', secret });
		return { name: player.name, username: player.username, guest: player.guest };
	} catch (e) {
		if (lost(e)) event.cookies.delete(SECRET_COOKIE, { path: '/' });
		if (lost(e) || (e instanceof PlatformError && e.status === 403)) return null;
		throw e;
	}
}

type Account = { player: Me; playerSecret?: string };

/**
 * Registers a username and password. A guest in this browser becomes the account (keeping their history);
 * without one, a new player is made. Returns the name and username to show.
 */
export async function register(
	event: RequestEvent,
	body: { name: string; username: string; password: string }
): Promise<Account['player']> {
	const send = (secret?: string) =>
		call<Account>(event, '/players/register', { method: 'POST', secret, body });
	let res: Account;
	try {
		res = await send(secretOf(event.cookies));
	} catch (e) {
		if (!lost(e)) throw e;
		res = await send(); // the guest's secret is gone: start a new account instead
	}
	if (res.playerSecret) saveSecret(event.cookies, res.playerSecret);
	return res.player;
}

/** Signs in: this browser gets its own secret for the account. */
export async function login(
	event: RequestEvent,
	body: { username: string; password: string }
): Promise<Account['player']> {
	const res = await call<Account>(event, '/players/login', { method: 'POST', body });
	saveSecret(event.cookies, res.playerSecret!);
	return res.player;
}

/** Signs this browser out. A secret the platform already forgot is fine: the cookie goes either way. */
export async function logout(event: RequestEvent): Promise<void> {
	const secret = secretOf(event.cookies);
	event.cookies.delete(SECRET_COOKIE, { path: '/' });
	if (!secret) return;
	try {
		await call(event, '/players/logout', { method: 'POST', secret });
	} catch (e) {
		if (!lost(e)) throw e;
	}
}

/** Renames an account. The platform refuses a guest: it keeps its generated name until it links an account. */
export async function savePlayerName(event: RequestEvent, name: string): Promise<void> {
	await call(event, '/players/me', {
		method: 'PATCH',
		secret: secretOrEnded(event.cookies),
		body: { name }
	});
}

/** A fresh play token. */
export async function playToken(event: RequestEvent): Promise<string> {
	return (
		await call<{ token: string }>(event, '/play-tokens', {
			method: 'POST',
			secret: secretOrEnded(event.cookies)
		})
	).token;
}

type Room = { id: string; code: string; game: string };

export type Visibility = 'public' | 'private';

/** Opens a new table: the platform picks the code. Public tables are listed in the lobby; private ones need an invite. */
export async function createRoom(
	event: RequestEvent,
	game: string,
	visibility: Visibility
): Promise<Room> {
	return (
		await call<{ room: Room }>(event, '/rooms', {
			method: 'POST',
			secret: secretOrEnded(event.cookies),
			body: { game, visibility }
		})
	).room;
}

export type Invite =
	{ kind: 'link'; token: string } | { kind: 'code'; code: string; expiresAt: string };

/** The table's invite link token (the same one until it is reset), or a new short-lived invite code. */
export async function createInvite(
	event: RequestEvent,
	code: string,
	kind: Invite['kind']
): Promise<Invite> {
	const path = `/rooms/${encodeURIComponent(code)}/invites`;
	return (
		await call<{ invite: Invite }>(event, path, {
			method: 'POST',
			secret: secretOrEnded(event.cookies),
			body: { kind }
		})
	).invite;
}

/** Kills the table's invite link; only its opener may. */
export async function resetInviteLink(event: RequestEvent, code: string): Promise<void> {
	await call(event, `/rooms/${encodeURIComponent(code)}/invites/link`, {
		method: 'DELETE',
		secret: secretOrEnded(event.cookies)
	});
}

/** Redeems an invite link token or code: this player may now enter the table. */
export async function redeemInvite(
	event: RequestEvent,
	invite: string
): Promise<{ code: string; game: string }> {
	return (
		await call<{ room: { code: string; game: string } }>(event, '/invites/redeem', {
			method: 'POST',
			secret: secretOrEnded(event.cookies),
			body: { invite }
		})
	).room;
}

/**
 * The room behind a code, if this player may enter it. Asked before every room token, so a code typed into
 * the URL can't create a room, and a room of another game is not found.
 */
export async function roomFor(event: RequestEvent, game: string, code: string): Promise<Room> {
	const secret = secretOf(event.cookies);
	if (!secret) throw new PlatformError(401, 'unauthenticated', 'Choose a name first.');
	const { room } = await call<{ room: Room }>(event, `/rooms/${encodeURIComponent(code)}`, {
		method: 'GET',
		secret
	});
	if (room.game !== game)
		throw new PlatformError(404, 'not_found', 'There is no table with that code.');
	return room;
}

export type Tournament = {
	id: string;
	name: string;
	startsAt: string;
	registrationClosesAt: string;
	playersPerRoom: number;
	registered: number;
	joined: boolean;
};
export type TournamentTable = {
	code: string;
	game: string;
	seat: number | null;
	tournament: { id: string; name: string; startsAt: string };
};

/** A game's tournaments open for sign-up, and the tournament tables this player sits at. Empty before they chose a name. */
export async function tournamentsFor(
	event: RequestEvent,
	game: string
): Promise<{ tournaments: Tournament[]; tables: TournamentTable[] }> {
	const secret = secretOf(event.cookies);
	const none = { tournaments: [], tables: [] };
	if (!secret) return none;
	const q = `game=${encodeURIComponent(game)}`;
	try {
		const [{ tournaments }, { rooms }] = await Promise.all([
			call<{ tournaments: Tournament[] }>(event, `/tournaments?${q}`, { method: 'GET', secret }),
			call<{ rooms: TournamentTable[] }>(event, `/players/me/rooms?${q}`, { method: 'GET', secret })
		]);
		return { tournaments, tables: rooms };
	} catch (e) {
		if (lost(e)) return none;
		throw e;
	}
}

/** Signs the player up for a tournament, or out of it. */
export async function setRegistration(
	event: RequestEvent,
	id: string,
	join: boolean
): Promise<void> {
	const secret = secretOf(event.cookies);
	if (!secret) throw new PlatformError(401, 'unauthenticated', 'Choose a name first.');
	await call(event, `/tournaments/${encodeURIComponent(id)}/registration`, {
		method: join ? 'POST' : 'DELETE',
		secret
	});
}

/** Reads a JSON `{ name }` body, or stops with 400. */
export async function readName(request: Request): Promise<string> {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (name.length < 1 || name.length > 20) error(400, 'Enter a name of 1-20 characters.');
	return name;
}

/** Same `{ error: { code, message } }` shape for every failure the browser sees. */
export function failure(e: unknown) {
	if (e instanceof PlatformError)
		return json(
			{ error: { code: e.code, message: e.message, fields: e.fields } },
			{ status: e.status }
		);
	throw e;
}
