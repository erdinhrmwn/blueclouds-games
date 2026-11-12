import { json } from '@sveltejs/kit';
import { apiError, failure, setRegistration } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handler(join: boolean): RequestHandler {
	return async (event) => {
		if (!UUID.test(event.params.id)) {
			return apiError(404, 'not_found', 'There is no such tournament.');
		}

		try {
			await setRegistration(event, event.params.id, join);
			return json({ registered: join });
		} catch (err) {
			return failure(err);
		}
	};
}

/** Signs the player up for a tournament. */
export const POST = handler(true);
/** Signs the player out again, while sign-up is open. */
export const DELETE = handler(false);
