// Guest identity: a random secret token + display name kept in this browser.
const TOKEN_KEY = 'guest-token';
const NAME_KEY = 'guest-name';

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null; // storage blocked (private mode): fall back to a per-tab identity
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Same reason as above; the session just won't survive a reload.
	}
}

export function guestToken(): string {
	const existing = read(TOKEN_KEY);
	if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
	const token = crypto.randomUUID().replaceAll('-', '');
	write(TOKEN_KEY, token);
	return token;
}

export const guestName = () => read(NAME_KEY) ?? '';
export const saveGuestName = (name: string) => write(NAME_KEY, name.trim());

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export function newRoomCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(5));
	return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);
