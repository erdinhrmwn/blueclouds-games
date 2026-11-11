import { json } from '@sveltejs/kit';
import { failure, readName, savePlayerName } from '#lib/server/platform.ts';
import type { RequestHandler } from './$types';

/** Saves the player's name on the platform (creating the guest on first use). */
export const POST: RequestHandler = async (event) => {
	const name = await readName(event.request);
	try {
		await savePlayerName(event, name);
		return json({ name });
	} catch (e) {
		return failure(e);
	}
};
