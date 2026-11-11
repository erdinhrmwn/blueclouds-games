import { fail, redirect } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import { createTournament, listTournaments, NewTournament, TournamentError } from '#lib/server/tournaments.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [tournaments, games] = await Promise.all([listTournaments(sql), sql`SELECT slug, name, min_players AS "minPlayers", max_players AS "maxPlayers" FROM games ORDER BY name`]);
	return { tournaments, games: [...games] as { slug: string; name: string; minPlayers: number; maxPlayers: number }[] };
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const form = Object.fromEntries(await request.formData());
		const values = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
		const parsed = NewTournament.safeParse(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')));
		if (!parsed.success) return fail(400, { values, error: parsed.error.issues[0]?.message ?? 'Some fields are invalid.' });
		let id: string;
		try {
			id = await createTournament(sql, locals.admin!, parsed.data, auditIp(getClientAddress()));
		} catch (e) {
			if (e instanceof TournamentError) return fail(400, { values, error: e.message });
			throw e;
		}
		redirect(303, `/tournaments/${id}`);
	}
};
