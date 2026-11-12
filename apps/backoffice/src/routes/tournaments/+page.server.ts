import { fail, redirect } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import {
	createTournament,
	listTournaments,
	NewTournament,
	TournamentError
} from '#lib/server/tournaments.ts';
import type { Actions, PageServerLoad } from './$types';

type GameOption = { slug: string; name: string; minPlayers: number; maxPlayers: number };

export const load: PageServerLoad = async () => {
	const gamesQuery = sql`
		SELECT slug, name, min_players AS "minPlayers", max_players AS "maxPlayers"
		FROM games
		ORDER BY name`;

	const [tournaments, games] = await Promise.all([listTournaments(sql), gamesQuery]);

	return {
		tournaments,
		games: [...games] as GameOption[]
	};
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const form = Object.fromEntries(await request.formData());
		const entries = Object.entries(form).map(([key, value]) => [key, String(value)]);
		const values = Object.fromEntries(entries);

		// Empty fields count as left out, so their defaults apply.
		const filled = Object.fromEntries(entries.filter(([, value]) => value !== ''));
		const parsed = NewTournament.safeParse(filled);

		if (!parsed.success) {
			const error = parsed.error.issues[0]?.message ?? 'Some fields are invalid.';
			return fail(400, { values, error });
		}

		let id: string;
		try {
			id = await createTournament(sql, locals.admin!, parsed.data, auditIp(getClientAddress()));
		} catch (err) {
			if (err instanceof TournamentError) return fail(400, { values, error: err.message });
			throw err;
		}

		redirect(303, `/tournaments/${id}`);
	}
};
