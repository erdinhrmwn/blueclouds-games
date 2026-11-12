import { json } from '@sveltejs/kit';
import { failure, setRegistration } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handler(join: boolean): RequestHandler {
	return async (event) => {
		if (!UUID.test(event.params.id)) {
			return json(
				{ error: { code: 'not_found', message: 'There is no such tournament.' } },
				{ status: 404 }
			);
		}
		try {
			await setRegistration(event, event.params.id, join);
			return json({ registered: join });
		} catch (e) {
			return failure(e);
		}
	};
}

/** Signs the player up for a tournament. */
export const POST = handler(true);
/** Signs the player out again, while sign-up is open. */
export const DELETE = handler(false);
