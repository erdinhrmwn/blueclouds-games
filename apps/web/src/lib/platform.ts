import type { Tournament, TournamentTable } from '#lib/server/platform.ts';

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
	let res: Response;
	try {
		res = await fetch(path, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new PlatformError('network', 'Could not reach the server. Check your connection and try again.');
	}
	const data = await res.json().catch(() => null);
	if (res.ok) return data as T;
	// Our routes answer { error: { code, message } }; SvelteKit's error() answers { message }.
	throw new PlatformError(data?.error?.code ?? 'internal', data?.error?.message ?? data?.message ?? 'Something went wrong. Try again.', data?.error?.fields);
}

const post = <T>(path: string, body: unknown) => request<T>('POST', path, body);

export const saveName = (name: string) => post<{ name: string }>('/api/player', { name });
export const fetchPlayToken = (name: string) => post<{ token: string }>('/api/play-token', { name });
type AccountPlayer = { player: { name: string; username: string | null } };
export const registerAccount = (body: { name: string; username: string; password: string }) => post<AccountPlayer>('/api/account/register', body);
export const signIn = (body: { username: string; password: string }) => post<AccountPlayer>('/api/account/login', body);
export const signOut = () => post<{ signedOut: true }>('/api/account/logout', {});
export const openRoom = (game: string, name: string) => post<{ code: string }>(`/api/${encodeURIComponent(game)}/rooms`, { name });

export type { Tournament, TournamentTable } from '#lib/server/platform.ts';
export const fetchTournaments = (game: string) =>
	request<{ tournaments: Tournament[]; tables: TournamentTable[] }>('GET', `/api/${encodeURIComponent(game)}/tournaments`);
export const setRegistration = (id: string, join: boolean) =>
	request<{ registered: boolean }>(join ? 'POST' : 'DELETE', `/api/tournaments/${encodeURIComponent(id)}/registration`);
