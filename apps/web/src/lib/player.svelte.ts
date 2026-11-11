import { guestName, playerSecret, saveGuestName, savePlayerSecret } from './guest.ts';
import { createGuest, fetchPlayToken, PlatformError, renamePlayer } from './platform.ts';

export const NAME_MAX = 20;

/**
 * The guest's display name, shared by every page. `ready` turns true once it has been read
 * from storage in the browser; until then nothing should ask for it.
 */
export const player = $state({ name: '', ready: false, editing: false });

export function loadPlayer(): void {
	player.name = guestName();
	player.ready = true;
}

// A secret the platform no longer knows (e.g. a reset dev database): start a fresh guest.
const lost = (e: unknown) => e instanceof PlatformError && e.code === 'unauthenticated';

async function newGuest(name: string): Promise<string> {
	const { playerSecret: secret } = await createGuest(name);
	savePlayerSecret(secret);
	return secret;
}

/** Saves the name on the platform (creating the guest on first use). Returns an error message, or null. */
export async function setPlayerName(raw: string): Promise<string | null> {
	const name = raw.trim();
	if (name.length < 1 || name.length > NAME_MAX) return `Enter a name of 1–${NAME_MAX} characters.`;
	try {
		const secret = playerSecret();
		if (!secret) await newGuest(name);
		else await renamePlayer(secret, name).catch((e) => (lost(e) ? newGuest(name) : Promise.reject(e)));
	} catch (e) {
		return e instanceof Error ? e.message : 'Something went wrong. Try again.';
	}
	saveGuestName(name);
	player.name = name;
	player.editing = false;
	return null;
}

/** A fresh play token for connecting to a room. Names saved before the platform existed get a guest here. */
export async function playToken(): Promise<string> {
	const secret = playerSecret() ?? (await newGuest(player.name));
	try {
		return (await fetchPlayToken(secret)).token;
	} catch (e) {
		if (!lost(e)) throw e;
		return (await fetchPlayToken(await newGuest(player.name))).token;
	}
}
