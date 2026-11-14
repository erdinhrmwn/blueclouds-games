import { fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import { listGames, setMaintenance } from '#lib/server/games.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { games: await listGames(sql) };
};

/** The game a form is about, from its hidden `slug` field. */
async function slugOf(request: Request): Promise<string> {
	const form = await request.formData();

	return String(form.get('slug') ?? '');
}

export const actions: Actions = {
	start: async ({ request, locals, getClientAddress }) => {
		const slug = await slugOf(request);
		const done = await setMaintenance(sql, locals.admin!, slug, true, auditIp(getClientAddress()));
		if (!done) {
			return fail(409, { error: 'This game is already under maintenance.' });
		}

		return { message: 'Maintenance started. No new tables or tournaments until you end it.' };
	},
	end: async ({ request, locals, getClientAddress }) => {
		const slug = await slugOf(request);
		const done = await setMaintenance(sql, locals.admin!, slug, false, auditIp(getClientAddress()));
		if (!done) {
			return fail(409, { error: 'This game is not under maintenance.' });
		}

		return { message: 'Maintenance ended. Players can open tables again.' };
	}
};
