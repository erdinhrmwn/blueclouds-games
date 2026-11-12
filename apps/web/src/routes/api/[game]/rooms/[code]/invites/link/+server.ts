import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { failure, resetInviteLink } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** The table's opener kills its invite link; the next ask makes a new one. */
export const DELETE: RequestHandler = async (event) => {
	if (!isRoomCode(event.params.code)) {
		return json(
			{ error: { code: 'not_found', message: 'There is no table with that code.' } },
			{ status: 404 }
		);
	}
	try {
		await resetInviteLink(event, event.params.code);
		return json({ revoked: true });
	} catch (e) {
		return failure(e);
	}
};
