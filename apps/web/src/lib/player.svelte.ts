import {
	fetchPlayToken,
	PlatformError,
	registerAccount,
	saveName,
	signIn,
	signOut,
	startGuest
} from './platform.ts';

export const NAME_MAX = 20;

const FALLBACK_ERROR = 'Something went wrong. Try again.';

const messageOf = (err: unknown) => (err instanceof Error ? err.message : FALLBACK_ERROR);

type Me = { name: string; username: string | null; guest: boolean };

/**
 * Who this browser plays as, shared by every page: `name` is empty for a new visitor. A guest has a generated
 * `guest_…` username and no password.
 * `ready` turns true once the server's answer is in; until then nothing should ask for it.
 * `playing` is true while a game runs at the open table, so the page can hide everything but the game.
 */
export const player = $state({
	name: '',
	username: '',
	guest: false,
	ready: false,
	editing: false,
	playing: false
});

/** Takes the server's answer (from the player cookie) as the truth; the browser keeps no copy of its own. */
export function loadPlayer(me: Me | null): void {
	player.name = me?.name ?? '';
	player.username = me?.username ?? '';
	player.guest = me?.guest ?? false;
	player.ready = true;
}

/** What a failed account form shows: one message per field, or one for the whole form. */
export type FormErrors = { form?: string; fields: Record<string, string> };

function signedIn(me: Me): void {
	loadPlayer(me);
	player.editing = false;
}

async function attempt(run: () => Promise<{ player: Me }>): Promise<FormErrors | null> {
	try {
		const result = await run();
		signedIn(result.player);
		return null;
	} catch (err) {
		const fields = err instanceof PlatformError ? err.fields : {};

		// Field messages show next to their fields; only without any does the form get one.
		const hasFieldErrors = Object.keys(fields).length > 0;
		return { form: hasFieldErrors ? undefined : messageOf(err), fields };
	}
}

/** Creates an account; a guest playing in this browser becomes it. */
export const createAccount = (body: { name: string; username: string; password: string }) =>
	attempt(() => registerAccount(body));

export const logIn = (body: { username: string; password: string }) => attempt(() => signIn(body));

/** Checks a display name the way the platform does; returns the message to show, or null. */
export function nameError(name: string): string | null {
	const length = name.trim().length;
	if (length < 1 || length > NAME_MAX) {
		return `Enter a name of 1–${NAME_MAX} characters.`;
	}

	return null;
}

/** "Play as guest" under the picked name; the platform makes up the username. */
export const playAsGuest = (name: string) => attempt(() => startGuest(name.trim()));

/** Signs out; the next game starts as a new guest. */
export async function logOut(): Promise<string | null> {
	try {
		await signOut();
	} catch (err) {
		return messageOf(err);
	}

	loadPlayer(null);
	return null;
}

/** Renames an account (a guest keeps its generated name until it links one). Returns an error message, or null. */
export async function setPlayerName(raw: string): Promise<string | null> {
	const name = raw.trim();
	const invalid = nameError(name);
	if (invalid) {
		return invalid;
	}

	try {
		await saveName(name);
	} catch (err) {
		return messageOf(err);
	}

	player.name = name;
	player.editing = false;
	return null;
}

/** A fresh play token for connecting to a room. */
export async function playToken(): Promise<string> {
	const { token } = await fetchPlayToken();
	return token;
}
