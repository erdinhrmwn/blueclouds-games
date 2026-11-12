import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';
import type { RoomSummary } from 'server/games/shared/schema';

/** The engine is on the same network; a list that takes longer than this is reported as unreachable. */
const ENGINE_TIMEOUT_MS = 3_000;

// The engine signed in with the admin token, like the web app's server. Only read here: the room lists.
const engine = createClient<typeof registry>({
	endpoint: RIVET_ENDPOINT,
	namespace: 'default',
	token: RIVET_TOKEN,
	devtools: false
});

export type OpenTables = {
	game: string;
	gameName: string;
	/** null when the engine could not be reached. */
	rooms: RoomSummary[] | null;
};

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('engine timeout')), ENGINE_TIMEOUT_MS);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Each game's public open tables, as its room list holds them. Private tables never report to the list, and
 * tournament tables come from the database instead (tournamentTables in tournaments.ts).
 */
export async function openTables(games: { slug: string; name: string }[]): Promise<OpenTables[]> {
	const lists = games.map(async (game) => {
		try {
			const rooms = await withTimeout(engine.roomList.getOrCreate([game.slug]).list());
			return { game: game.slug, gameName: game.name, rooms };
		} catch (err) {
			console.warn('live tables: room list unreachable', game.slug, String(err));
			return { game: game.slug, gameName: game.name, rooms: null };
		}
	});

	return Promise.all(lists);
}

/** One row of the Live tables list: an open table from the engine or a tournament table from the database. */
export type LiveTable = {
	code: string;
	game: string;
	gameName: string;
	kind: 'open' | 'tournament';
	phase: 'lobby' | 'playing' | 'finished';
	players: number;
	/** Seats at the table, filled or not: every one shows. */
	seatCount: number;
	/** Open tables: who opened it. */
	host: string | null;
	tournament: { id: string; name: string } | null;
	/** Who sits where. Open tables have no player ids; a tournament player's seat is null until the room seats them. */
	seats: { seat: number | null; name: string; playerId: string | null; bot: boolean }[];
};
