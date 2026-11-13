import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { apiError, failure, roomGame } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Which game a table code belongs to, so a code typed on the landing page can find its table. */
export const GET: RequestHandler = async (event) => {
	const code = event.params.code.toUpperCase();
	if (!isRoomCode(code)) {
		return apiError(400, 'invalid', 'A table code is 4–8 letters or digits.');
	}

	try {
		const game = await roomGame(event, code);
		return json({ game });
	} catch (err) {
		return failure(err);
	}
};
