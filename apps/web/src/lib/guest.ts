export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);

/** A typed invite code: 6 characters from the platform's alphabet (no 0/O, 1/I). */
export const isInviteCode = (code: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(code);

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
