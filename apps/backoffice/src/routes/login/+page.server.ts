import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { auditIp, login, SESSION_COOKIE, SESSION_HOURS } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 256;

export const load: PageServerLoad = ({ locals }) => {
	if (locals.admin) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').slice(0, MAX_USERNAME_LENGTH);
		const password = String(form.get('password') ?? '').slice(0, MAX_PASSWORD_LENGTH);

		if (!username || !password) {
			return fail(400, { username, error: 'Enter your username and password.' });
		}

		const result = await login(sql, username, password, auditIp(getClientAddress()));
		if (!result.ok) {
			const error =
				result.reason === 'locked'
					? 'Too many failed tries. Wait 15 minutes, then try again.'
					: 'Wrong username or password.';
			return fail(400, { username, error });
		}

		cookies.set(SESSION_COOKIE, result.token, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: SESSION_HOURS * 60 * 60
		});

		redirect(303, '/');
	}
};
