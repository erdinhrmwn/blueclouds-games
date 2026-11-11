import { PUBLIC_PLATFORM_URL } from '$app/env/public';

/** The only place the web app talks to the BlueClouds Platform API. */

type Player = { id: string; name: string };
type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const TIMEOUT_MS = 10_000;

export class PlatformError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

async function call<T>(path: string, init: { method: string; secret?: string; body?: unknown }): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${PUBLIC_PLATFORM_URL}/v1${path}`, {
			method: init.method,
			headers: {
				...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
				...(init.secret ? { Authorization: `Bearer ${init.secret}` } : {})
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		throw new PlatformError('network', 'Could not reach the server. Check your connection and try again.');
	}
	const json = (await res.json().catch(() => null)) as Envelope<T> | null;
	if (json?.ok) return json.data;
	throw new PlatformError(json?.error.code ?? 'internal', json?.error.message ?? 'Something went wrong. Try again.');
}

export const createGuest = (name: string) =>
	call<{ player: Player; playerSecret: string }>('/players/guest', { method: 'POST', body: { name } });

export const renamePlayer = (secret: string, name: string) =>
	call<{ player: Player }>('/players/me', { method: 'PATCH', secret, body: { name } });

export const fetchPlayToken = (secret: string) =>
	call<{ token: string; expiresAt: string }>('/play-tokens', { method: 'POST', secret });
