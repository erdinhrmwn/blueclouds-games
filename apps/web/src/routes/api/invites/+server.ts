import { json } from '@sveltejs/kit';
import { isInviteCode } from '#lib/guest.ts';
import { failure, redeemInvite } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Redeems a typed invite code: answers the table to go to. Links are redeemed by /invite/[token]. */
export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as { code?: unknown } | null;
	const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
	if (!isInviteCode(code)) {
		return json(
			{ error: { code: 'bad_input', message: 'An invite code is 6 letters or digits.' } },
			{ status: 400 }
		);
	}
	try {
		return json(await redeemInvite(event, code));
	} catch (e) {
		return failure(e);
	}
};
