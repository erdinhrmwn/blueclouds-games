import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';

type RoomAccess = { actorId: string; token: string };

/** The table exists for someone else, or not at all (a private table without an invite, another tournament's table). */
export class RoomRefused extends Error {}

async function roomAccess(game: string, code: string): Promise<RoomAccess> {
	const res = await fetch(
		`/api/${encodeURIComponent(game)}/rooms/${encodeURIComponent(code)}/token`,
		{ method: 'POST', cache: 'no-store' }
	);
	if (!res.ok) {
		// Our route answers { error: { message } } for known cases (unknown code, no name yet).
		const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
		const text = body?.error?.message ?? 'Could not reach the game server. Try again.';
		throw res.status === 403 || res.status === 404 ? new RoomRefused(text) : new Error(text);
	}
	return (await res.json()) as RoomAccess;
}

/**
 * A Rivet client for one room. Our server issues its engine tokens, and each one reaches only
 * that room's actor; the engine's admin token never reaches the browser.
 */
export async function roomClient(game: string, code: string) {
	const first = await roomAccess(game, code);
	let unused: string | null = first.token;
	const getToken = async () => {
		const token = unused ?? (await roomAccess(game, code)).token;
		unused = null;
		return token;
	};
	// devtools off: the local engine does not serve the devtools bundle, which only adds a 404.
	const client = createClient<typeof registry>({
		endpoint: PUBLIC_RIVET_ENDPOINT,
		devtools: false,
		getToken
	});
	return { client, actorId: first.actorId };
}
