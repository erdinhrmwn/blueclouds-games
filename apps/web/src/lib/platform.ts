import type { Invite, Tournament, TournamentTable, Visibility } from '#lib/server/platform.ts';

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
export const startGuest = () => post<AccountPlayer>('/api/player/guest', {});
export const registerAccount = (body: { name: string; username: string; password: string }) =>
	post<AccountPlayer>('/api/account/register', body);
export const signIn = (body: { username: string; password: string }) =>
	post<AccountPlayer>('/api/account/login', body);
export const signOut = () => post<{ signedOut: true }>('/api/account/logout', {});

// Tables and invites

export const openRoom = (game: string, visibility: Visibility) =>
	post<{ code: string }>(`/api/${encodeURIComponent(game)}/rooms`, { visibility });
export const createInvite = <K extends Invite['kind']>(game: string, code: string, kind: K) =>
	post<Extract<Invite, { kind: K }>>(invitesPath(game, code), { kind });
export const resetInviteLink = (game: string, code: string) =>
	request<{ revoked: true }>('DELETE', `${invitesPath(game, code)}/link`);
export const redeemInviteCode = (code: string) =>
	post<{ code: string; game: string }>('/api/invites', { code });

// Tournaments

export type { Tournament, TournamentTable, Visibility } from '#lib/server/platform.ts';
export const fetchTournaments = (game: string) =>
	request<{ tournaments: Tournament[]; tables: TournamentTable[] }>(
		'GET',
		`/api/${encodeURIComponent(game)}/tournaments`
	);
export const setRegistration = (id: string, join: boolean) =>
	request<{ registered: boolean }>(
		join ? 'POST' : 'DELETE',
		`/api/tournaments/${encodeURIComponent(id)}/registration`
	);
