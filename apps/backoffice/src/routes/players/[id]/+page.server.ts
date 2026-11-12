import { error, fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { listAudit, NO_AUDIT_FILTER } from '#lib/server/audit-log.ts';
import { sql } from '#lib/server/db.ts';
import {
	disablePlayer,
	enablePlayer,
	grantVip,
	playerDetail,
	REASON_MAX,
	revokeVip
} from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

const AUDIT_ROWS = 10;

export const load: PageServerLoad = async ({ params }) => {
	const filter = { ...NO_AUDIT_FILTER, player: params.id };
	const [detail, audit] = await Promise.all([
		playerDetail(sql, params.id),
		listAudit(sql, filter, AUDIT_ROWS)
	]);
	if (!detail) error(404, 'Player not found');

	return { ...detail, audit };
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
	grantVip: async ({ params, locals, getClientAddress }) => {
		const ip = auditIp(getClientAddress());
		const done = await grantVip(sql, locals.admin!, params.id, ip);
		if (!done) return fail(409, { error: 'This player is already a VIP.' });

		return { message: 'Player is now a VIP.' };
	},
	revokeVip: async ({ params, locals, getClientAddress }) => {
		const ip = auditIp(getClientAddress());
		const done = await revokeVip(sql, locals.admin!, params.id, ip);
		if (!done) return fail(409, { error: 'This player is not a VIP.' });

		return { message: 'VIP taken away.' };
	}
};
