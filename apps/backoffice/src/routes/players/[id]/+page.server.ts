import { error, fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { listAudit, NO_AUDIT_FILTER } from '#lib/server/audit-log.ts';
import { sql } from '#lib/server/db.ts';
import { balanceOf, coinHistory } from '../../../../../platform/src/services/coins.ts';
import {
	adjustCoins,
	COIN_ADJUST_MAX,
	CoinAdjustError,
	disablePlayer,
	enablePlayer,
	grantVip,
	playerDetail,
	REASON_MAX,
	revokeVip
} from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

const AUDIT_ROWS = 10;
/** Coin changes the player page lists; the full history is the player's own Coins page. */
const COIN_ROWS = 10;

export const load: PageServerLoad = async ({ params }) => {
	const filter = { ...NO_AUDIT_FILTER, player: params.id };
	const [detail, audit] = await Promise.all([
		playerDetail(sql, params.id),
		listAudit(sql, filter, AUDIT_ROWS)
	]);
	if (!detail) error(404, 'Player not found');

	const [coins, coinRows] = await Promise.all([
		balanceOf(sql, params.id),
		coinHistory(sql, params.id)
	]);

	return { ...detail, audit, coins, coinHistory: coinRows.slice(0, COIN_ROWS) };
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
	adjustCoins: async ({ params, request, locals, getClientAddress }) => {
		const form = await request.formData();
		const amountText = String(form.get('amount') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();
		const amount = Number(amountText);

		const validAmount =
			Number.isSafeInteger(amount) && amount !== 0 && Math.abs(amount) <= COIN_ADJUST_MAX;
		if (!validAmount) {
			return fail(400, {
				amount: amountText,
				note,
				coinError: 'Enter a whole number of coins, minus to take them away.'
			});
		}
		if (!note || note.length > REASON_MAX) {
			return fail(400, {
				amount: amountText,
				note,
				coinError: `Say why, in 1-${REASON_MAX} characters.`
			});
		}

		try {
			const balance = await adjustCoins(
				sql,
				locals.admin!,
				params.id,
				amount,
				note,
				auditIp(getClientAddress())
			);
			return { message: `Done. They now have ${balance.toLocaleString('en')} coins.` };
		} catch (err) {
			if (err instanceof CoinAdjustError) {
				return fail(409, { amount: amountText, note, coinError: err.message });
			}
			throw err;
		}
	},
	revokeVip: async ({ params, locals, getClientAddress }) => {
		const ip = auditIp(getClientAddress());
		const done = await revokeVip(sql, locals.admin!, params.id, ip);
		if (!done) return fail(409, { error: 'This player is not a VIP.' });

		return { message: 'VIP taken away.' };
	}
};
