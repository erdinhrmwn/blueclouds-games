import { error, fail } from '@sveltejs/kit';
import {
	auditIp,
	changeOwnPassword,
	PASSWORD_MAX,
	PASSWORD_MIN,
	SESSION_COOKIE
} from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

/** What each refusal tells the admin. */
const ERRORS = {
	wrong_password: 'Your current password is wrong.',
	locked: 'Too many wrong tries. Wait 15 minutes, then try again.',
	too_short: `The new password needs at least ${PASSWORD_MIN} characters.`,
	too_long: `The new password can be at most ${PASSWORD_MAX} characters.`,
	unchanged: 'The new password must differ from the current one.'
} as const;

export const load: PageServerLoad = () => ({ passwordMin: PASSWORD_MIN });

export const actions: Actions = {
	changePassword: async ({ request, locals, cookies, getClientAddress }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (!locals.admin || !token) {
			error(401, 'Sign in first.');
		}

		const form = await request.formData();
		// One more than the limit, so an over-long password is refused rather than cut.
		const current = String(form.get('current') ?? '').slice(0, PASSWORD_MAX + 1);
		const next = String(form.get('next') ?? '').slice(0, PASSWORD_MAX + 1);
		const repeat = String(form.get('repeat') ?? '').slice(0, PASSWORD_MAX + 1);

		if (!current || !next) {
			return fail(400, { error: 'Enter your current password and a new one.' });
		}

		if (next !== repeat) {
			return fail(400, { error: 'The two new passwords are not the same.' });
		}

		const input = { current, next };
		const result = await changeOwnPassword(
			sql,
			locals.admin,
			token,
			input,
			auditIp(getClientAddress())
		);
		if (!result.ok) {
			return fail(400, { error: ERRORS[result.reason] });
		}

		return { message: 'Password changed. Your other sessions were signed out.' };
	}
};
