import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, sessionAdmin } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = await sessionAdmin(sql, event.cookies.get(SESSION_COOKIE));
	if (!event.locals.admin && event.url.pathname !== '/login') redirect(303, '/login');
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
