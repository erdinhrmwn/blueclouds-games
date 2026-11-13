import { error, json, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/env';
import { PLATFORM_URL } from '$app/env/private';
import type { MatchRounds } from '#lib/rounds.ts';
import { log } from './log.ts';

/**
 * The game's server side of the platform: the browser calls our /api routes, and this module
 * calls the platform over the internal network. The player secret lives only in an httpOnly cookie.
 */

const SECRET_COOKIE = 'player_secret';
/** 400 days: the longest browsers keep a cookie. */
const SECRET_MAX_AGE = 400 * 24 * 60 * 60;
const TIMEOUT_MS = 5_000;
const NAME_MAX = 20;

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
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		// The platform rate-limits guests by IP; it trusts this header because only we can reach it.
		'X-Forwarded-For': event.getClientAddress()
	};
	if (init.secret) {
		headers.Authorization = `Bearer ${init.secret}`;
	}

	let res: Response;
	try {
		res = await fetch(`${PLATFORM_URL}/v1${path}`, {
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (err) {
		log.error({ msg: 'platform unreachable', path, err });
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

/** "Play as guest": a new guest for this browser under the name it picked; the platform makes up the username. */
export async function startGuest(event: RequestEvent, name: string): Promise<Me> {
	const { player, playerSecret } = await call<{ player: Me; playerSecret: string }>(
		event,
		'/players/guest',
		{ method: 'POST', body: { name } }
	);

	saveSecret(event.cookies, playerSecret);

	return { name: player.name, username: player.username, guest: player.guest };
}

/** A secret the platform no longer knows (e.g. a reset database). */
const lost = (err: unknown) => err instanceof PlatformError && err.code === 'unauthenticated';

/** Every page needs a player (see +layout.server.ts), so a missing one here means the session ended. */
const ended = () =>
	new PlatformError(401, 'unauthenticated', 'Your session ended. Reload the page to continue.');

function secretOrEnded(cookies: Cookies): string {
	const secret = secretOf(cookies);
	if (!secret) throw ended();

	return secret;
}

/** Like secretOrEnded, for a visitor who may simply not have chosen a name yet. */
function secretOrNameFirst(cookies: Cookies): string {
	const secret = secretOf(cookies);
	if (!secret) throw new PlatformError(401, 'unauthenticated', 'Choose a name first.');

	return secret;
}

export type Me = {
	name: string;
	username: string | null;
	guest: boolean;
	/** Coin balance; left out where an answer doesn't carry it (sign-in, register). */
	coins?: number;
};

/**
 * Who this browser plays as, asked from the platform on every page load so the page never trusts a stale copy.
 * Null for a new visitor, a secret the platform forgot, or a disabled player.
 */
export async function whoAmI(event: RequestEvent): Promise<Me | null> {
	const secret = secretOf(event.cookies);
	if (!secret) return null;

	try {
		const { player, coins } = await call<{ player: Me; coins: number }>(event, '/players/me', {
			method: 'GET',
			secret
		});
		return { name: player.name, username: player.username, guest: player.guest, coins };
	} catch (err) {
		if (lost(err)) {
			event.cookies.delete(SECRET_COOKIE, { path: '/' });
			return null;
		}

		const disabled = err instanceof PlatformError && err.status === 403;
		if (disabled) return null;

		throw err;
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
	} catch (err) {
		if (!lost(err)) throw err;

		// The guest's secret is gone: start a new account instead.
		res = await send();
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

/** Changes an account's password; the platform signs every other device out. */
export async function changePassword(
	event: RequestEvent,
	body: { currentPassword: string; newPassword: string }
): Promise<void> {
	await call(event, '/players/me/password', { method: 'PUT', secret: signedIn(event), body });
}

/** Signs this browser out. A secret the platform already forgot is fine: the cookie goes either way. */
export async function logout(event: RequestEvent): Promise<void> {
	const secret = secretOf(event.cookies);
	event.cookies.delete(SECRET_COOKIE, { path: '/' });
	if (!secret) return;

	try {
		await call(event, '/players/logout', { method: 'POST', secret });
	} catch (err) {
		if (!lost(err)) throw err;
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
	const { token } = await call<{ token: string }>(event, '/play-tokens', {
		method: 'POST',
		secret: secretOrEnded(event.cookies)
	});

	return token;
}

type Room = { id: string; code: string; game: string };

export type Visibility = 'public' | 'private';

/** Opens a new table: the platform picks the code. Public tables are listed in the lobby; private ones need an invite. */
export async function createRoom(
	event: RequestEvent,
	game: string,
	visibility: Visibility,
	name: string | null = null
): Promise<Room> {
	const { room } = await call<{ room: Room }>(event, '/rooms', {
		method: 'POST',
		secret: secretOrEnded(event.cookies),
		body: { game, visibility, name: name ?? undefined }
	});

	return room;
}

/** Which game a table code belongs to, if this player may enter it (else a PlatformError). */
export async function roomGame(event: RequestEvent, code: string): Promise<string> {
	const path = `/rooms/${encodeURIComponent(code)}`;
	const { room } = await call<{ room: { game: string } }>(event, path, {
		method: 'GET',
		secret: signedIn(event)
	});

	return room.game;
}

/** The table's invite link token, the same one until it is reset. */
export async function createInvite(event: RequestEvent, code: string): Promise<{ token: string }> {
	const path = `/rooms/${encodeURIComponent(code)}/invites`;
	const { invite } = await call<{ invite: { token: string } }>(event, path, {
		method: 'POST',
		secret: secretOrEnded(event.cookies)
	});

	return invite;
}

/** Kills the table's invite link; only its opener may. */
export async function resetInviteLink(event: RequestEvent, code: string): Promise<void> {
	await call(event, `/rooms/${encodeURIComponent(code)}/invites/link`, {
		method: 'DELETE',
		secret: secretOrEnded(event.cookies)
	});
}

/** Redeems an invite link token: this player may now enter the table. */
export async function redeemInvite(
	event: RequestEvent,
	invite: string
): Promise<{ code: string; game: string }> {
	const { room } = await call<{ room: { code: string; game: string } }>(event, '/invites/redeem', {
		method: 'POST',
		secret: secretOrEnded(event.cookies),
		body: { invite }
	});

	return room;
}

/**
 * The room behind a code, if this player may enter it. Asked before every room token, so a code typed into
 * the URL can't create a room, and a room of another game is not found.
 */
export async function roomFor(event: RequestEvent, game: string, code: string): Promise<Room> {
	const secret = secretOrNameFirst(event.cookies);

	const { room } = await call<{ room: Room }>(event, `/rooms/${encodeURIComponent(code)}`, {
		method: 'GET',
		secret
	});

	if (room.game !== game) {
		throw new PlatformError(404, 'not_found', 'There is no table with that code.');
	}

	return room;
}

export type Tournament = {
	id: string;
	name: string;
	startsAt: string;
	registrationClosesAt: string;
	playersPerRoom: number;
	/** Fewest players it runs with, else it is cancelled when sign-up closes; null for no minimum. */
	minPlayers: number | null;
	/** Most sign-ups, which closes sign-up; null for a tournament that takes anyone. */
	maxPlayers: number | null;
	/** How it is played; a label until matchmaking for it exists. */
	format: TournamentFormat | null;
	/** Arena and Swiss: how many rounds it plays; null for a knockout. */
	rounds: number | null;
	description: string | null;
	/** By finishing place, 1st first; nothing is paid out by the platform. */
	prizes: TournamentPrize[];
	registrationOpensAt: string;
	/** Names of the first few to sign up, in the order they did. */
	players: string[];
	/** In coins; 0 is free. Nothing is charged. */
	fee: number;
	registered: number;
	joined: boolean;
};

export type TournamentFormat = 'arena' | 'knockout' | 'swiss';

/** One row of a tournament's standings; the final places once it finished. */
export type Standing = {
	place: number;
	playerId: string;
	name: string;
	points: number;
	wins: number;
	/** The furthest round they were seated in; in a knockout, below the current round means out. */
	lastRound: number;
};

/** A tournament that is playing, or finished within the last day, as the lobby shows it. */
export type LiveTournament = {
	id: string;
	name: string;
	format: TournamentFormat | null;
	/** Arena and Swiss: rounds in all; null for a knockout. */
	rounds: number | null;
	/** The latest round, and when its tables start. */
	round: number;
	roundStartsAt: string;
	roundStarted: boolean;
	/** When round 1 started; with `endedAt`, how long it ran. */
	startsAt: string;
	endedAt: string | null;
	/** Finished: whether an admin paid the prizes out yet. */
	prizesPaid: boolean;
	/** How many sat down in round 1. */
	players: number;
	prizes: TournamentPrize[];
	/** The top of the standings (or the winners). */
	top: Standing[];
	me: Standing | null;
	/** The player's table in the latest round, if they have one. */
	table: { code: string; started: boolean; closed: boolean } | null;
};

export type TournamentPrize = { place: number; coins: number; extra: string | null };

export type TournamentTable = {
	code: string;
	game: string;
	seat: number | null;
	/** Its match began: withdrawing is no longer possible, the player leaves from the table. */
	started: boolean;
	tournament: { id: string; name: string; startsAt: string };
};

/** A game's tournaments open for sign-up, and the tournament tables this player sits at. Empty before they chose a name. */
export async function tournamentsFor(
	event: RequestEvent,
	game: string
): Promise<{ tournaments: Tournament[]; live: LiveTournament[]; tables: TournamentTable[] }> {
	const secret = secretOf(event.cookies);
	const none = { tournaments: [], live: [], tables: [] };
	if (!secret) return none;

	const query = `game=${encodeURIComponent(game)}`;
	const get = { method: 'GET', secret };

	try {
		const [{ tournaments, live }, { rooms }] = await Promise.all([
			call<{ tournaments: Tournament[]; live: LiveTournament[] }>(
				event,
				`/tournaments?${query}`,
				get
			),
			call<{ rooms: TournamentTable[] }>(event, `/players/me/rooms?${query}`, get)
		]);

		return { tournaments, live, tables: rooms };
	} catch (err) {
		if (lost(err)) return none;
		throw err;
	}
}

/** Whether a game is under maintenance (no new tables). False when it can't be asked, e.g. before a name. */
export async function underMaintenance(event: RequestEvent, game: string): Promise<boolean> {
	const secret = secretOf(event.cookies);
	if (!secret) return false;

	try {
		const { games } = await call<{ games: { slug: string; maintenance: boolean }[] }>(
			event,
			'/games',
			{ method: 'GET', secret }
		);

		return games.some((entry) => entry.slug === game && entry.maintenance);
	} catch (err) {
		if (lost(err)) return false;
		throw err;
	}
}

/** Signs the player up for a tournament. */
export async function joinTournament(event: RequestEvent, id: string): Promise<void> {
	const secret = secretOrNameFirst(event.cookies);

	await call(event, `/tournaments/${encodeURIComponent(id)}/registration`, {
		method: 'POST',
		secret
	});
}

/** A tournament's standings: worked out from the matches so far, or its final places once it finished. */
export async function tournamentStandings(event: RequestEvent, id: string): Promise<Standing[]> {
	const secret = secretOrNameFirst(event.cookies);
	const { standings } = await call<{ standings: Standing[] }>(
		event,
		`/tournaments/${encodeURIComponent(id)}/standings`,
		{ method: 'GET', secret }
	);

	return standings;
}

/** Signs the player out of a tournament, while sign-up is open. */
export async function leaveTournament(event: RequestEvent, id: string): Promise<void> {
	const secret = secretOrNameFirst(event.cookies);

	await call(event, `/tournaments/${encodeURIComponent(id)}/registration`, {
		method: 'DELETE',
		secret
	});
}

/** Reads a JSON `{ name }` body, or stops with 400. */
export async function readName(request: Request): Promise<string> {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (name.length < 1 || name.length > NAME_MAX) {
		error(400, `Enter a name of 1-${NAME_MAX} characters.`);
	}

	return name;
}

/** One of the player's finished matches, as their history lists it. */
export type MatchSummary = {
	id: string;
	game: string;
	roomCode: string;
	startedAt: string;
	endedAt: string;
	endReason: 'finished' | 'terminated';
	players: number;
	seat: number;
	placement: number;
	score: number;
};

/** The player's finished matches, newest first, a page at a time. */
export async function myMatches(
	event: RequestEvent,
	cursor: string | null
): Promise<{ matches: MatchSummary[]; nextCursor: string | null }> {
	const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';

	return call(event, `/players/me/matches${query}`, { method: 'GET', secret: signedIn(event) });
}

/** The player's record in one game: finished matches played, and won. */
export type GameStats = { game: string; played: number; wins: number; bestStreak: number };

/** The signed-in player's record per game, for their profile. */
export async function myStats(event: RequestEvent): Promise<{ games: GameStats[] }> {
	return call(event, '/players/me/stats', { method: 'GET', secret: signedIn(event) });
}

/** A match's rounds, running or finished. Matches are public: any player may look. */
export async function matchRounds(event: RequestEvent, matchId: string): Promise<MatchRounds> {
	const path = `/matches/${encodeURIComponent(matchId)}/rounds`;

	return call(event, path, { method: 'GET', secret: signedIn(event) });
}

/** What changed a player's coins: a fee, refund, prize, bonus or an admin's change with its note. */
export type CoinChange = {
	id: string;
	amount: number;
	balanceAfter: number;
	reason:
		| 'signup_bonus'
		| 'admin_grant'
		| 'admin_take'
		| 'tournament_fee'
		| 'tournament_refund'
		| 'tournament_prize';
	note: string | null;
	at: string;
	tournament: { id: string; name: string; cancelled: boolean } | null;
};

/** The player's coins and their history, newest first. */
export async function coinsOf(
	event: RequestEvent
): Promise<{ balance: number; history: CoinChange[] }> {
	return call(event, '/players/me/coins', { method: 'GET', secret: signedIn(event) });
}

/** One table of a tournament round, its players best finish first; an unplayed seat has no placement. */
export type BoardTable = {
	code: string;
	startedAt: string | null;
	closedAt: string | null;
	closeReason: string | null;
	players: { playerId: string; name: string; seat: number | null; placement: number | null }[];
};

/** A tournament's own page: what it is, every round's tables (the bracket), and the standings. */
export type TournamentBoard = {
	tournament: {
		id: string;
		game: string;
		name: string;
		format: TournamentFormat | null;
		rounds: number | null;
		/** Seats at each table. */
		playersPerRoom: number;
		startsAt: string;
		endedAt: string | null;
		cancelled: boolean;
		players: number;
		prizes: TournamentPrize[];
	};
	rounds: { round: number; startsAt: string; endedAt: string | null; tables: BoardTable[] }[];
	standings: Standing[];
	me: Standing | null;
};

export async function tournamentBoard(event: RequestEvent, id: string): Promise<TournamentBoard> {
	return call(event, `/tournaments/${encodeURIComponent(id)}`, {
		method: 'GET',
		secret: signedIn(event)
	});
}

/** The player's secret, or a 401 the browser sees like any other platform answer. */
function signedIn(event: RequestEvent): string {
	const secret = secretOf(event.cookies);
	if (!secret) {
		throw new PlatformError(401, 'unauthenticated', 'Sign in as a player first.');
	}

	return secret;
}

/** An error answer in the same `{ error: { code, message } }` shape as `failure`. */
export function apiError(status: number, code: string, message: string) {
	return json({ error: { code, message } }, { status });
}

export const BUSY_MESSAGE = 'The game server is busy. Try again in a moment.';

/** Same `{ error: { code, message } }` shape for every failure the browser sees. */
export function failure(err: unknown) {
	if (!(err instanceof PlatformError)) throw err;

	const error = { code: err.code, message: err.message, fields: err.fields };
	return json({ error }, { status: err.status });
}
