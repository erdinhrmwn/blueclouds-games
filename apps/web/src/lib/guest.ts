export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);

/** A starting guest name like "Player-87b1"; the visitor can change it before playing. */
export function suggestGuestName(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(2));
	const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

	return `Player-${suffix}`;
}

/** The page anyone without a player (guest or account) is sent to first. */
export const WELCOME = '/welcome';

/** The parts of a page URL used here (SvelteKit's `page.url` has read-only search params). */
type PageUrl = Pick<URL, 'origin' | 'search'> & { searchParams: Pick<URLSearchParams, 'get'> };

/** Where to go once you're in: the page you first asked for (same site only), else home. */
export function nextPath(url: PageUrl): string {
	const next = url.searchParams.get('next');
	if (!next?.startsWith('/')) return '/';

	// `//evil.example` also starts with "/": resolving it shows whether it leaves the site.
	const to = new URL(next, url.origin);
	const sameSite = to.origin === url.origin;
	if (!sameSite || to.pathname === WELCOME) return '/';

	return to.pathname + to.search;
}
