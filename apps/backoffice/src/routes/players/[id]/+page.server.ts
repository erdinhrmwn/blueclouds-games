import { error, fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import {
	disablePlayer,
	enablePlayer,
	playerDetail,
	REASON_MAX,
	setVip
} from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const detail = await playerDetail(sql, params.id);
	if (!detail) error(404, 'Player not found');

	return detail;
};

export const actions: Actions = {
	disable: async ({ params, request, locals, getClientAddress }) => {
		const form = await request.formData();
		const reason = String(form.get('reason') ?? '').trim();

		if (!reason || reason.length > REASON_MAX) {
			return fail(400, { reason, error: `Give a reason of 1-${REASON_MAX} characters.` });
		}

		const ip = auditIp(getClientAddress());
		const done = await disablePlayer(sql, locals.admin!, params.id, reason, ip);
		if (!done) {
			return fail(409, { reason, error: 'This player is already disabled, or no longer exists.' });
		}

		return { message: 'Player disabled. Their sessions were signed out.' };
	},
	enable: async ({ params, locals, getClientAddress }) => {
		const ip = auditIp(getClientAddress());
		const done = await enablePlayer(sql, locals.admin!, params.id, ip);
		if (!done) return fail(409, { error: 'This player is already active.' });

		return { message: 'Player enabled. They start a new guest session next time they play.' };
	},
	vip: async ({ params, request, locals, getClientAddress }) => {
		const form = await request.formData();
		const vip = form.get('vip') === 'true';

		const ip = auditIp(getClientAddress());
		const done = await setVip(sql, locals.admin!, params.id, vip, ip);
		if (!done) {
			const error = vip ? 'This player is already a VIP.' : 'This player is not a VIP.';
			return fail(409, { error });
		}

		return { message: vip ? 'Player is now a VIP.' : 'VIP taken away.' };
	}
};
