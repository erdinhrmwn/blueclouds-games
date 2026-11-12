import { sql } from '#lib/server/db.ts';
import { type LiveTable, openTables, tournamentRounds } from '#lib/server/live.ts';
import { matchGames } from '#lib/server/matches.ts';
import { tournamentTables } from '#lib/server/tournaments.ts';
import type { PageServerLoad } from './$types';

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
