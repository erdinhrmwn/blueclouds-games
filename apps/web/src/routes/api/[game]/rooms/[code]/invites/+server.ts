import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { createInvite, failure } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** `{ kind: 'link' }` answers the table's invite link token; `{ kind: 'code' }` makes a short-lived invite code. */
export const POST: RequestHandler = async (event) => {
	if (!isRoomCode(event.params.code)) {
		return json(
			{ error: { code: 'not_found', message: 'There is no table with that code.' } },
			{ status: 404 }
		);
	}
	const body = (await event.request.json().catch(() => null)) as { kind?: unknown } | null;
	if (body?.kind !== 'link' && body?.kind !== 'code') {
		return json(
			{ error: { code: 'bad_input', message: 'Ask for a link or a code.' } },
			{ status: 400 }
		);
	}
	try {
		return json(await createInvite(event, event.params.code, body.kind), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (e) {
		return failure(e);
	}
};
