import { error, fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import { isUuid } from '#lib/server/players.ts';
import {
	assignPlayer,
	cancelTournament,
	distributeNow,
	parseIds,
	registerPlayers,
	tournamentDetail,
	TournamentError,
	unassignPlayer,
	unregisterPlayer
} from '#lib/server/tournaments.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const detail = await tournamentDetail(sql, params.id);
	if (!detail) error(404, 'Tournament not found');
	return detail;
};

/** Runs a change; a broken rule comes back as the form's error instead of a 500. */
async function attempt(run: () => Promise<string>, values: Record<string, string> = {}) {
	try {
		return { message: await run() };
	} catch (e) {
		if (e instanceof TournamentError) return fail(400, { error: e.message, ...values });
		throw e;
	}
}

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const playerIdOf = (data: FormData) => {
	const id = field(data, 'playerId').toLowerCase();
	if (!isUuid(id)) throw new TournamentError('That is not a player id.');
	return id;
};

export const actions: Actions = {
	register: async ({ params, request, locals, getClientAddress }) => {
		const text = field(await request.formData(), 'ids');
		const { ids, invalid } = parseIds(text);
		if (invalid.length) return fail(400, { error: `Not player ids: ${invalid.slice(0, 5).join(', ')}`, ids: text });
		return attempt(async () => {
			const r = await registerPlayers(sql, locals.admin!, params.id, ids, auditIp(getClientAddress()));
			return `Registered ${r.added} player${r.added === 1 ? '' : 's'}.${r.already ? ` ${r.already} already were.` : ''}`;
		}, { ids: text });
	},
	unregister: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		return attempt(async () => {
			await unregisterPlayer(sql, locals.admin!, params.id, playerIdOf(data), auditIp(getClientAddress()));
			return 'Player removed from the tournament.';
		});
	},
	distribute: async ({ params, locals, getClientAddress }) =>
		attempt(async () => {
			const r = await distributeNow(sql, locals.admin!, params.id, auditIp(getClientAddress()));
			return `Sign-up closed. ${r.players} players got ${r.rooms} table${r.rooms === 1 ? '' : 's'}.`;
		}),
	assign: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		return attempt(async () => {
			const code = field(data, 'room').toUpperCase();
			const seat = await assignPlayer(sql, locals.admin!, params.id, code, playerIdOf(data), auditIp(getClientAddress()));
			return `Seated at table ${code}, seat ${seat + 1}.`;
		});
	},
	unassign: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		return attempt(async () => {
			await unassignPlayer(sql, locals.admin!, params.id, playerIdOf(data), auditIp(getClientAddress()));
			return 'Player taken off their table. They are still registered.';
		});
	},
	cancel: async ({ params, locals, getClientAddress }) =>
		attempt(async () => {
			await cancelTournament(sql, locals.admin!, params.id, auditIp(getClientAddress()));
			return 'Tournament cancelled. Its tables no longer let anyone in.';
		})
};
