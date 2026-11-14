import { redirect } from '@sveltejs/kit';
import { PlatformError, redeemInvite } from '#lib/server/platform.ts';
import type { PageServerLoad } from './$types';

const TOKEN = /^[0-9a-f]{32}$/;

/** An invite link: the player becomes a member of the table and goes straight there. */
export const load: PageServerLoad = async (event) => {
	// The layout sends a visitor without a player to the welcome page first, then back here.
	await event.parent();

	if (!TOKEN.test(event.params.token)) {
		return { problem: 'This invite link is not complete. Ask for a new one.' };
	}

	let room: { code: string; game: string };
	try {
		room = await redeemInvite(event, event.params.token);
	} catch (err) {
		if (err instanceof PlatformError) {
			return { problem: err.message };
		}

		throw err;
	}

	redirect(303, `/${room.game}/room/${room.code}`);
};
