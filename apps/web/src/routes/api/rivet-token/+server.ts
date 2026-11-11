import { json } from '@sveltejs/kit';
import { issueBrowserToken } from '#lib/server/rivet.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	try {
		return json({ token: await issueBrowserToken() }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.error('rivet token failed', String(err));
		return json({ error: { code: 'unavailable', message: 'The game server is busy. Try again in a moment.' } }, { status: 503 });
	}
};
