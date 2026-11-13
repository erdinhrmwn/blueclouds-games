import type { Tournament, TournamentTable, Visibility } from '#lib/server/platform.ts';

/** The browser's side of the platform: our own /api routes, which call the platform server to server. */

export class PlatformError extends Error {
	constructor(
		readonly code: string,
		message: string,
		/** One message per invalid field, when the platform named them. */
		readonly fields: Record<string, string> = {}
	) {
		super(message);
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const hasBody = body !== undefined;

	let res: Response;
	try {
		res = await fetch(path, {
			method,
			headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
			body: hasBody ? JSON.stringify(body) : undefined
		});
	} catch {
		throw new PlatformError(
			'network',
			'Could not reach the server. Check your connection and try again.'
		);
	}

	const data = await res.json().catch(() => null);
	if (res.ok) return data as T;

	// Our routes answer { error: { code, message } }; SvelteKit's error() answers { message }.
	const code = data?.error?.code ?? 'internal';
	const message = data?.error?.message ?? data?.message ?? 'Something went wrong. Try again.';
	throw new PlatformError(code, message, data?.error?.fields);
}

const post = <T>(path: string, body: unknown) => request<T>('POST', path, body);

type AccountPlayer = { player: { name: string; username: string | null; guest: boolean } };

const invitesPath = (game: string, code: string) =>
	`/api/${encodeURIComponent(game)}/rooms/${encodeURIComponent(code)}/invites`;

// Player and account

export const saveName = (name: string) => post<{ name: string }>('/api/player', { name });
export const fetchPlayToken = () => post<{ token: string }>('/api/play-token', {});
export const startGuest = (name: string) => post<AccountPlayer>('/api/player/guest', { name });
export const registerAccount = (body: { name: string; username: string; password: string }) =>
	post<AccountPlayer>('/api/account/register', body);
export const signIn = (body: { username: string; password: string }) =>
	post<AccountPlayer>('/api/account/login', body);
export const signOut = () => post<{ signedOut: true }>('/api/account/logout', {});
export const updatePassword = (body: { currentPassword: string; newPassword: string }) =>
	request<{ changed: true }>('PUT', '/api/account/password', body);

// Tables and invites

export const findRoom = (code: string) =>
	request<{ game: string }>('GET', `/api/rooms/${encodeURIComponent(code)}`);

export const openRoom = (game: string, visibility: Visibility, name: string) =>
	post<{ code: string }>(`/api/${encodeURIComponent(game)}/rooms`, { visibility, name });
export const createInvite = (game: string, code: string) =>
	post<{ token: string }>(invitesPath(game, code), {});
export const resetInviteLink = (game: string, code: string) =>
	request<{ revoked: true }>('DELETE', `${invitesPath(game, code)}/link`);

// Tournaments

export type { Tournament, TournamentTable, Visibility } from '#lib/server/platform.ts';
export const fetchTournaments = (game: string) =>
	request<{ tournaments: Tournament[]; tables: TournamentTable[] }>(
		'GET',
		`/api/${encodeURIComponent(game)}/tournaments`
	);
export const joinTournament = (id: string) =>
	request<{ registered: boolean }>(
		'POST',
		`/api/tournaments/${encodeURIComponent(id)}/registration`
	);
export const leaveTournament = (id: string) =>
	request<{ registered: boolean }>(
		'DELETE',
		`/api/tournaments/${encodeURIComponent(id)}/registration`
	);
