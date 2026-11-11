// The guest's display name, kept in this browser. Who they are (the player secret) is an httpOnly cookie.
const NAME_KEY = 'guest-name';
/** Set while this browser is signed in to an account; only for showing it, the cookie is what counts. */
const USERNAME_KEY = 'account-username';

// Storage can be blocked (private mode): then the identity lives in this tab only.
const memory = new Map<string, string>();

function read(key: string): string | null {
	try {
		return localStorage.getItem(key) ?? memory.get(key) ?? null;
	} catch {
		return memory.get(key) ?? null;
	}
}

function write(key: string, value: string | null): void {
	if (value === null) memory.delete(key);
	else memory.set(key, value);
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Kept in memory above; it just won't survive a reload.
	}
}

export const guestName = () => read(NAME_KEY) ?? '';
export const saveGuestName = (name: string) => write(NAME_KEY, name.trim());
export const savedUsername = () => read(USERNAME_KEY) ?? '';
export const saveUsername = (username: string | null) => write(USERNAME_KEY, username);

export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);
