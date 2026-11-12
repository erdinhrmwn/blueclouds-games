import { redirect } from '@sveltejs/kit';
import { auditIp, logout, SESSION_COOKIE } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: async ({ cookies, locals, getClientAddress }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token && locals.admin) {
			await logout(sql, token, locals.admin, auditIp(getClientAddress()));
		}

		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
