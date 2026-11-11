import { guestName, saveGuestName } from './guest.ts';

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

/** Returns an error message, or null when the name was saved. */
export function setPlayerName(raw: string): string | null {
	const name = raw.trim();
	if (name.length < 1 || name.length > NAME_MAX) return `Enter a name of 1–${NAME_MAX} characters.`;
	saveGuestName(name);
	player.name = name;
	player.editing = false;
	return null;
}
