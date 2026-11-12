import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { apiError, failure, resetInviteLink } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** The table's opener kills its invite link; the next ask makes a new one. */
export const DELETE: RequestHandler = async (event) => {
	if (!isRoomCode(event.params.code)) {
		return apiError(404, 'not_found', 'There is no table with that code.');
	}

	try {
		await resetInviteLink(event, event.params.code);
		return json({ revoked: true });
	} catch (err) {
		return failure(err);
	}
};
