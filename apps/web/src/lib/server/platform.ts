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

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export class PlatformError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

async function call<T>(event: RequestEvent, path: string, init: { method: string; secret?: string; body?: unknown }): Promise<T> {
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
	throw new PlatformError(res.status, body?.error.code ?? 'internal', body?.error.message ?? 'Something went wrong. Try again.');
}

const secretOf = (cookies: Cookies) => cookies.get(SECRET_COOKIE);
const saveSecret = (cookies: Cookies, secret: string) =>
	cookies.set(SECRET_COOKIE, secret, { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge: SECRET_MAX_AGE });

async function newGuest(event: RequestEvent, name: string): Promise<string> {
	const { playerSecret } = await call<{ playerSecret: string }>(event, '/players/guest', { method: 'POST', body: { name } });
	saveSecret(event.cookies, playerSecret);
	return playerSecret;
}

// A secret the platform no longer knows (e.g. a reset database): start a fresh guest.
const lost = (e: unknown) => e instanceof PlatformError && e.code === 'unauthenticated';

/** Renames the player, creating the guest on first use. */
export async function savePlayerName(event: RequestEvent, name: string): Promise<void> {
	const secret = secretOf(event.cookies);
	if (!secret) return void (await newGuest(event, name));
	try {
		await call(event, '/players/me', { method: 'PATCH', secret, body: { name } });
	} catch (e) {
		if (!lost(e)) throw e;
		await newGuest(event, name);
	}
}

/** A fresh play token. `name` is only used if the guest has to be (re)created. */
export async function playToken(event: RequestEvent, name: string): Promise<string> {
	const secret = secretOf(event.cookies) ?? (await newGuest(event, name));
	const fetchToken = (s: string) => call<{ token: string }>(event, '/play-tokens', { method: 'POST', secret: s });
	try {
		return (await fetchToken(secret)).token;
	} catch (e) {
		if (!lost(e)) throw e;
		return (await fetchToken(await newGuest(event, name))).token;
	}
}

type Room = { id: string; code: string; game: string };

/** Opens a new table: the platform picks the code. `name` is only used if the guest has to be (re)created. */
export async function createRoom(event: RequestEvent, game: string, name: string): Promise<Room> {
	const open = (s: string) => call<{ room: Room }>(event, '/rooms', { method: 'POST', secret: s, body: { game } });
	const secret = secretOf(event.cookies) ?? (await newGuest(event, name));
	try {
		return (await open(secret)).room;
	} catch (e) {
		if (!lost(e)) throw e;
		return (await open(await newGuest(event, name))).room;
	}
}

/**
 * The room behind a code, if this player may enter it. Asked before every room token, so a code typed into
 * the URL can't create a room, and a room of another game is not found.
 */
export async function roomFor(event: RequestEvent, game: string, code: string): Promise<Room> {
	const secret = secretOf(event.cookies);
	if (!secret) throw new PlatformError(401, 'unauthenticated', 'Choose a name first.');
	const { room } = await call<{ room: Room }>(event, `/rooms/${encodeURIComponent(code)}`, { method: 'GET', secret });
	if (room.game !== game) throw new PlatformError(404, 'not_found', 'There is no table with that code.');
	return room;
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
	if (e instanceof PlatformError) return json({ error: { code: e.code, message: e.message } }, { status: e.status });
	throw e;
}
