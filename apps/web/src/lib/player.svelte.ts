import { guestName, saveGuestName, savedUsername, saveUsername } from './guest.ts';
import { fetchPlayToken, PlatformError, registerAccount, saveName, signIn, signOut } from './platform.ts';

export const NAME_MAX = 20;

/**
 * The guest's display name, shared by every page. `ready` turns true once it has been read
 * from storage in the browser; until then nothing should ask for it. `playing` is true while
 * a game runs at the open table, so the page can hide everything but the game.
 */
export const player = $state({ name: '', username: '', ready: false, editing: false, playing: false });

export function loadPlayer(): void {
	player.name = guestName();
	player.username = savedUsername();
	player.ready = true;
}

/** What a failed account form shows: one message per field, or one for the whole form. */
export type FormErrors = { form?: string; fields: Record<string, string> };

function signedIn(p: { name: string; username: string | null }): void {
	saveGuestName(p.name);
	saveUsername(p.username);
	player.name = p.name;
	player.username = p.username ?? '';
	player.editing = false;
}

async function attempt(run: () => Promise<{ player: { name: string; username: string | null } }>): Promise<FormErrors | null> {
	try {
		signedIn((await run()).player);
		return null;
	} catch (e) {
		const fields = e instanceof PlatformError ? e.fields : {};
		return { form: Object.keys(fields).length ? undefined : e instanceof Error ? e.message : 'Something went wrong. Try again.', fields };
	}
}

/** Creates an account; a guest playing in this browser becomes it. */
export const createAccount = (body: { name: string; username: string; password: string }) => attempt(() => registerAccount(body));
export const logIn = (body: { username: string; password: string }) => attempt(() => signIn(body));

/** Signs out; the next game starts as a new guest. */
export async function logOut(): Promise<string | null> {
	try {
		await signOut();
	} catch (e) {
		return e instanceof Error ? e.message : 'Something went wrong. Try again.';
	}
	saveGuestName('');
	saveUsername(null);
	player.name = '';
	player.username = '';
	return null;
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
