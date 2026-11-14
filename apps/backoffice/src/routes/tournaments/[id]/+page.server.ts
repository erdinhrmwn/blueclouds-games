import { error, fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import { isUuid } from '#lib/server/players.ts';
import {
	assignPlayer,
	cancelTournament,
	disqualifyPlayer,
	distributeNow,
	parseIds,
	REASON_MAX,
	registerPlayers,
	tournamentDetail,
	payPrizes,
	TournamentError,
	unassignPlayer,
	unregisterPlayer
} from '#lib/server/tournaments.ts';
import type { Actions, PageServerLoad } from './$types';

/** How many bad ids an error message names. */
const INVALID_IDS_SHOWN = 5;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const load: PageServerLoad = async ({ params }) => {
	const detail = await tournamentDetail(sql, params.id);
	if (!detail) {
		error(404, 'Tournament not found');
	}

	return { ...detail, reasonMax: REASON_MAX };
};

/** Runs a change; a broken rule comes back as the form's error instead of a 500. */
async function attempt(run: () => Promise<string>, values: Record<string, string> = {}) {
	try {
		const message = await run();
		return { message };
	} catch (err) {
		if (err instanceof TournamentError) {
			return fail(400, { error: err.message, ...values });
		}

		throw err;
	}
}

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

function playerIdOf(data: FormData): string {
	const id = field(data, 'playerId').toLowerCase();
	if (!isUuid(id)) {
		throw new TournamentError('That is not a player id.');
	}

	return id;
}

export const actions: Actions = {
	register: async ({ params, request, locals, getClientAddress }) => {
		const text = field(await request.formData(), 'ids');
		const { ids, invalid } = parseIds(text);

		if (invalid.length > 0) {
			const shown = invalid.slice(0, INVALID_IDS_SHOWN).join(', ');
			return fail(400, { error: `Not player ids: ${shown}`, ids: text });
		}

		const register = async () => {
			const ip = auditIp(getClientAddress());
			const result = await registerPlayers(sql, locals.admin!, params.id, ids, ip);

			const alreadyNote = result.already ? ` ${result.already} already were.` : '';
			return `Registered ${plural(result.added, 'player')}.${alreadyNote}`;
		};

		return attempt(register, { ids: text });
	},
	unregister: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		return attempt(async () => {
			const ip = auditIp(getClientAddress());
			await unregisterPlayer(sql, locals.admin!, params.id, playerIdOf(data), ip);

			return 'Player removed from the tournament.';
		});
	},
	distribute: async ({ params, locals, getClientAddress }) =>
		attempt(async () => {
			const ip = auditIp(getClientAddress());
			const result = await distributeNow(sql, locals.admin!, params.id, ip);

			return `Sign-up closed. ${result.players} players got ${plural(result.rooms, 'table')}.`;
		}),
	assign: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		return attempt(async () => {
			const code = field(data, 'room').toUpperCase();
			const ip = auditIp(getClientAddress());
			const seat = await assignPlayer(sql, locals.admin!, params.id, code, playerIdOf(data), ip);

			return `Seated at table ${code}, seat ${seat + 1}.`;
		});
	},
	unassign: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		return attempt(async () => {
			const ip = auditIp(getClientAddress());
			await unassignPlayer(sql, locals.admin!, params.id, playerIdOf(data), ip);

			return 'Player taken off their table. They are still registered.';
		});
	},
	disqualify: async ({ params, request, locals, getClientAddress }) => {
		const data = await request.formData();
		const reason = field(data, 'reason');

		return attempt(
			async () => {
				const ip = auditIp(getClientAddress());
				const target = { playerId: playerIdOf(data), reason };
				const { runningTable } = await disqualifyPlayer(sql, locals.admin!, params.id, target, ip);

				const kickHint = runningTable
					? ` Their table ${runningTable} is playing: kick them there from Live tables.`
					: '';
				return `Player disqualified. They can't play in this tournament anymore.${kickHint}`;
			},
			{ reason }
		);
	},
	cancel: async ({ params, locals, getClientAddress }) =>
		attempt(async () => {
			const ip = auditIp(getClientAddress());
			await cancelTournament(sql, locals.admin!, params.id, ip);

			return 'Tournament cancelled. Its tables no longer let anyone in, and every fee went back.';
		}),
	payout: async ({ params, locals, getClientAddress }) =>
		attempt(async () => {
			const ip = auditIp(getClientAddress());
			const paid = await payPrizes(sql, locals.admin!, params.id, ip);
			const coins = paid.coins.toLocaleString('en');

			return `Paid ${coins} coins to ${paid.players} ${paid.players === 1 ? 'player' : 'players'}.`;
		})
};
