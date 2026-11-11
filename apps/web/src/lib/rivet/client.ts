import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';

type RoomAccess = { actorId: string; token: string };

async function roomAccess(code: string): Promise<RoomAccess> {
	const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/token`, { method: 'POST', cache: 'no-store' });
	if (!res.ok) throw new Error('Could not reach the game server. Try again.');
	return (await res.json()) as RoomAccess;
}

/**
 * A Rivet client for one room. Our server issues its engine tokens, and each one reaches only
 * that room's actor; the engine's admin token never reaches the browser.
 */
export async function roomClient(code: string) {
	const first = await roomAccess(code);
	let unused: string | null = first.token;
	const getToken = async () => {
		const token = unused ?? (await roomAccess(code)).token;
		unused = null;
		return token;
	};
	// devtools off: the local engine does not serve the devtools bundle, which only adds a 404.
	const client = createClient<typeof registry>({ endpoint: PUBLIC_RIVET_ENDPOINT, devtools: false, getToken });
	return { client, actorId: first.actorId };
}
