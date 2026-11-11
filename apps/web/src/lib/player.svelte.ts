import { guestName, saveGuestName } from './guest.ts';
import { fetchPlayToken, saveName } from './platform.ts';

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

/** Saves the name on the platform (creating the guest on first use). Returns an error message, or null. */
export async function setPlayerName(raw: string): Promise<string | null> {
	const name = raw.trim();
	if (name.length < 1 || name.length > NAME_MAX) return `Enter a name of 1–${NAME_MAX} characters.`;
	try {
		await saveName(name);
	} catch (e) {
		return e instanceof Error ? e.message : 'Something went wrong. Try again.';
	}
	saveGuestName(name);
	player.name = name;
	player.editing = false;
	return null;
}

/** A fresh play token for connecting to a room. */
export const playToken = async () => (await fetchPlayToken(player.name)).token;
