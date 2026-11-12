import { json } from '@sveltejs/kit';
import { isRoomCode } from '#lib/guest.ts';
import { apiError, createInvite, failure } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** `{ kind: 'link' }` answers the table's invite link token; `{ kind: 'code' }` makes a short-lived invite code. */
export const POST: RequestHandler = async (event) => {
	if (!isRoomCode(event.params.code)) {
		return apiError(404, 'not_found', 'There is no table with that code.');
	}

	const body = (await event.request.json().catch(() => null)) as { kind?: unknown } | null;
	if (body?.kind !== 'link' && body?.kind !== 'code') {
		return apiError(400, 'bad_input', 'Ask for a link or a code.');
	}

	try {
		const invite = await createInvite(event, event.params.code, body.kind);
		return json(invite, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		return failure(err);
	}
};
