import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { canEdit } from '#lib/server/admins.ts';
import { SESSION_COOKIE, sessionAdmin } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';

/** The only pages a viewer may post to: about their own session and account. */
const VIEWER_POSTS = new Set(['/logout', '/account']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = await sessionAdmin(sql, event.cookies.get(SESSION_COOKIE));
	if (!event.locals.admin && event.url.pathname !== '/login') {
		redirect(303, '/login');
	}

	// Viewers read only: every form post but signing out and changing their own password is refused here, so no
	// action can forget the check.
	const changes = event.request.method !== 'GET' && event.request.method !== 'HEAD';
	const ownAccount = VIEWER_POSTS.has(event.url.pathname);
	if (changes && !ownAccount && event.locals.admin && !canEdit(event.locals.admin)) {
		error(403, 'Viewers can look but not change anything.');
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'same-origin');

	return response;
};
