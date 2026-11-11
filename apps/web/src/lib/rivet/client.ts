import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';

/** A short-lived engine token from our own server; the engine's admin token never reaches the browser. */
async function getToken(): Promise<string> {
	const res = await fetch('/api/rivet-token', { method: 'POST', cache: 'no-store' });
	if (!res.ok) throw new Error('Could not reach the game server. Try again.');
	return ((await res.json()) as { token: string }).token;
}

// devtools off: the local engine does not serve the devtools bundle, which only adds a 404.
export const client = createClient<typeof registry>({ endpoint: PUBLIC_RIVET_ENDPOINT, devtools: false, getToken });
