/** The browser's side of the platform: our own /api routes, which call the platform server to server. */

export class PlatformError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

async function post<T>(path: string, body: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	} catch {
		throw new PlatformError('network', 'Could not reach the server. Check your connection and try again.');
	}
	const data = await res.json().catch(() => null);
	if (res.ok) return data as T;
	// Our routes answer { error: { code, message } }; SvelteKit's error() answers { message }.
	throw new PlatformError(data?.error?.code ?? 'internal', data?.error?.message ?? data?.message ?? 'Something went wrong. Try again.');
}

export const saveName = (name: string) => post<{ name: string }>('/api/player', { name });
export const fetchPlayToken = (name: string) => post<{ token: string }>('/api/play-token', { name });
export const openRoom = (game: string, name: string) => post<{ code: string }>(`/api/${encodeURIComponent(game)}/rooms`, { name });
