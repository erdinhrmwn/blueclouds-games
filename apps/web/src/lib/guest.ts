// Guest identity kept in this browser: the platform's player secret + display name.
const SECRET_KEY = 'player-secret';
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

export const playerSecret = () => read(SECRET_KEY);
export const savePlayerSecret = (secret: string) => write(SECRET_KEY, secret);
export const guestName = () => read(NAME_KEY) ?? '';
export const saveGuestName = (name: string) => write(NAME_KEY, name.trim());

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export function newRoomCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(5));
	return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);
