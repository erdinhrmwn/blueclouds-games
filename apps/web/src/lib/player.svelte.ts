import { fetchPlayToken, PlatformError, registerAccount, saveName, signIn, signOut, startGuest } from './platform.ts';

export const NAME_MAX = 20;

type Me = { name: string; username: string | null; guest: boolean };

/**
 * Who this browser plays as, shared by every page: `name` is empty for a new visitor. A guest has a generated
 * `guest_…` username and no password.
 * `ready` turns true once the server's answer is in; until then nothing should ask for it.
 * `playing` is true while a game runs at the open table, so the page can hide everything but the game.
 */
export const player = $state({ name: '', username: '', guest: false, ready: false, editing: false, playing: false });

/** Takes the server's answer (from the player cookie) as the truth; the browser keeps no copy of its own. */
export function loadPlayer(me: Me | null): void {
	player.name = me?.name ?? '';
	player.username = me?.username ?? '';
	player.guest = me?.guest ?? false;
	player.ready = true;
}

/** What a failed account form shows: one message per field, or one for the whole form. */
export type FormErrors = { form?: string; fields: Record<string, string> };

function signedIn(p: Me): void {
	loadPlayer(p);
	player.editing = false;
}

async function attempt(run: () => Promise<{ player: Me }>): Promise<FormErrors | null> {
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
/** "Play as guest": the platform makes up the name and username. */
export const playAsGuest = () => attempt(startGuest);

/** Signs out; the next game starts as a new guest. */
export async function logOut(): Promise<string | null> {
	try {
		await signOut();
	} catch (e) {
		return e instanceof Error ? e.message : 'Something went wrong. Try again.';
	}
	loadPlayer(null);
	return null;
}

/** Renames an account (a guest keeps its generated name until it links one). Returns an error message, or null. */
export async function setPlayerName(raw: string): Promise<string | null> {
	const name = raw.trim();
	if (name.length < 1 || name.length > NAME_MAX) return `Enter a name of 1–${NAME_MAX} characters.`;
	try {
		await saveName(name);
	} catch (e) {
		return e instanceof Error ? e.message : 'Something went wrong. Try again.';
	}
	player.name = name;
	player.editing = false;
	return null;
}

/** A fresh play token for connecting to a room. */
export const playToken = async () => (await fetchPlayToken()).token;
