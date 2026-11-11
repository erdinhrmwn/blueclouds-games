// The guest's display name, kept in this browser. Who they are (the player secret) is an httpOnly cookie.
const NAME_KEY = 'guest-name';

// Storage can be blocked (private mode): then the identity lives in this tab only.
const memory = new Map<string, string>();

function read(key: string): string | null {
	try {
		return localStorage.getItem(key) ?? memory.get(key) ?? null;
	} catch {
		return memory.get(key) ?? null;
	}
}

function write(key: string, value: string): void {
	memory.set(key, value);
	try {
		localStorage.setItem(key, value);
	} catch {
		// Kept in memory above; it just won't survive a reload.
	}
}

export const guestName = () => read(NAME_KEY) ?? '';
export const saveGuestName = (name: string) => write(NAME_KEY, name.trim());

export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);
