export const isRoomCode = (code: string) => /^[A-Z0-9]{4,8}$/.test(code);

/** The page anyone without a player (guest or account) is sent to first. */
export const WELCOME = '/welcome';

/** The parts of a page URL used here (SvelteKit's `page.url` has read-only search params). */
type PageUrl = Pick<URL, 'origin' | 'search'> & { searchParams: Pick<URLSearchParams, 'get'> };

/** Where to go once you're in: the page you first asked for (same site only), else home. */
export function nextPath(url: PageUrl): string {
	const next = url.searchParams.get('next');
	if (!next?.startsWith('/')) return '/';
	const to = new URL(next, url.origin);
	return to.origin === url.origin && to.pathname !== WELCOME ? to.pathname + to.search : '/';
}
