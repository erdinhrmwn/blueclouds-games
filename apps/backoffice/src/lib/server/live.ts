import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';
import { type RoomSummary, tournamentListKey } from 'server/games/shared/schema';

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

/** One room list from the engine, or null when it can't be reached in time. */
async function readList(key: string): Promise<RoomSummary[] | null> {
	try {
		return await withTimeout(engine.roomList.getOrCreate([key]).list());
	} catch (err) {
		console.warn('live tables: room list unreachable', key, String(err));
		return null;
	}
}

/**
 * Each game's public open tables, as its room list holds them. Private tables never report to the list, and
 * tournament tables come from the database instead (tournamentTables in tournaments.ts).
 */
export async function openTables(games: { slug: string; name: string }[]): Promise<OpenTables[]> {
	const lists = games.map(async (game) => {
		const rooms = await readList(game.slug);
		return { game: game.slug, gameName: game.name, rooms };
	});

	return Promise.all(lists);
}

/**
 * The round each tournament table is on, by table code, from the tournament room lists. A table nobody is
 * connected to isn't on its list, so it has no round here.
 */
export async function tournamentRounds(games: { slug: string }[]): Promise<Map<string, number>> {
	const lists = await Promise.all(games.map((game) => readList(tournamentListKey(game.slug))));
	const rooms = lists.flatMap((list) => list ?? []);

	return new Map(rooms.map((room) => [room.code, room.round ?? 0]));
}

/** One row of the Live tables list: an open table from the engine or a tournament table from the database. */
export type LiveTable = {
	code: string;
	game: string;
	gameName: string;
	kind: 'open' | 'tournament';
	phase: 'lobby' | 'playing' | 'finished';
	/** The round being played; 0 before the first deal or when the room isn't reporting. */
	round: number;
	players: number;
	/** Seats at the table, filled or not: every one shows. */
	seatCount: number;
	/** Open tables: who opened it. */
	host: string | null;
	tournament: { id: string; name: string } | null;
	/** Who sits where. Open tables have no player ids; a tournament player's seat is null until the room seats them. */
	seats: { seat: number | null; name: string; playerId: string | null; bot: boolean }[];
};
