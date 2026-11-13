import { fail } from '@sveltejs/kit';
import { auditIp } from '#lib/server/auth.ts';
import { sql } from '#lib/server/db.ts';
import {
	kickFromLiveTable,
	type LiveTable,
	openTables,
	REASON_MAX,
	TableActionError,
	terminateLiveTable,
	tournamentRounds
} from '#lib/server/live.ts';
import { matchGames } from '#lib/server/matches.ts';
import { tournamentTables } from '#lib/server/tournaments.ts';
import type { Actions, PageServerLoad } from './$types';

/** The table a form is about and the reason the admin gave. Viewers never get here (hooks.server.ts). */
function tableForm(form: FormData) {
	return {
		game: String(form.get('game') ?? ''),
		code: String(form.get('code') ?? ''),
		reason: String(form.get('reason') ?? '')
			.trim()
			.slice(0, REASON_MAX)
	};
}

/** A failed table action, worded for the admin, with the table it was about so its dialog stays open. */
function refused(code: string, err: unknown) {
	if (!(err instanceof TableActionError)) {
		throw err;
	}

	return fail(409, { code, error: err.message });
}

export const load: PageServerLoad = async () => {
	const games = await matchGames(sql);
	const [lists, rounds, tournament] = await Promise.all([
		openTables(games),
		tournamentRounds(games),
		tournamentTables(sql)
	]);

	const open: LiveTable[] = lists.flatMap((list) =>
		(list.rooms ?? []).map((room) => ({
			code: room.code,
			game: list.game,
			gameName: list.gameName,
			kind: 'open' as const,
			phase: room.phase,
			round: room.round ?? 0,
			players: room.players,
			seatCount: room.maxPlayers,
			host: room.host,
			tournament: null,
			// Rooms on older code report no seats.
			seats: (room.seats ?? []).map((seat) => ({ ...seat, playerId: null }))
		}))
	);

	const seated: LiveTable[] = tournament.map((table) => ({
		code: table.code,
		game: table.game,
		gameName: table.gameName,
		kind: 'tournament' as const,
		phase: table.startedAt ? 'playing' : 'lobby',
		round: rounds.get(table.code) ?? 0,
		players: table.seats.length,
		seatCount: table.seatCount,
		host: null,
		tournament: { id: table.tournamentId, name: table.tournamentName },
		seats: table.seats.map((seat) => ({ ...seat, bot: false }))
	}));

	const unreachable = lists.filter((list) => list.rooms === null).map((list) => list.gameName);

	return {
		games,
		tables: [...seated, ...open],
		unreachable,
		checkedAt: new Date()
	};
};

export const actions: Actions = {
	terminate: async ({ request, locals, getClientAddress }) => {
		const target = tableForm(await request.formData());
		if (!target.reason) {
			return fail(400, { code: target.code, error: 'Say why the table is terminated.' });
		}

		try {
			const result = await terminateLiveTable(
				sql,
				locals.admin!,
				target,
				auditIp(getClientAddress())
			);
			const saved = result.matchId ? ' Its match was saved as terminated.' : '';

			return { message: `Table ${target.code} terminated.${saved}` };
		} catch (err) {
			return refused(target.code, err);
		}
	},
	kick: async ({ request, locals, getClientAddress }) => {
		const form = await request.formData();
		const target = { ...tableForm(form), seat: Number(form.get('seat')) };
		if (!Number.isInteger(target.seat)) {
			return fail(400, { code: target.code, error: 'Pick a player to kick.' });
		}
		if (!target.reason) {
			return fail(400, { code: target.code, error: 'Say why the player is kicked.' });
		}

		try {
			const result = await kickFromLiveTable(
				sql,
				locals.admin!,
				target,
				auditIp(getClientAddress())
			);

			return { message: `${result.name} was kicked from table ${target.code}.` };
		} catch (err) {
			return refused(target.code, err);
		}
	}
};
