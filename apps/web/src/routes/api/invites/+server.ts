import { json } from '@sveltejs/kit';
import { isInviteCode } from '#lib/guest.ts';
import { apiError, failure, redeemInvite } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Redeems a typed invite code: answers the table to go to. Links are redeemed by /invite/[token]. */
export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as { code?: unknown } | null;
	const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
	if (!isInviteCode(code)) {
		return apiError(400, 'bad_input', 'An invite code is 6 letters or digits.');
	}

	try {
		const room = await redeemInvite(event, code);
		return json(room);
	} catch (err) {
		return failure(err);
	}
};
