import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { apiError, createInvite, failure } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Answers the table's invite link token, the same one until the opener resets it. */
export const POST: RequestHandler = async (event) => {
	if (!isRoomCode(event.params.code)) {
		return apiError(404, 'not_found', 'There is no table with that code.');
	}

	try {
		const invite = await createInvite(event, event.params.code);
		return json(invite, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		return failure(err);
	}
};
