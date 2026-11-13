import type { SQL } from 'bun';
import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private';
import { ActorError, createClient } from 'rivetkit/client';
import type { registry } from 'server';
import type { KickResult, TerminateResult } from 'server/games/shared/room';
import { type RoomSummary, tournamentListKey } from 'server/games/shared/schema';
import { type Admin, audit } from './auth.ts';
import { log } from './log.ts';
import { isUuid } from './players.ts';

/** The engine is on the same network; a list that takes longer than this is reported as unreachable. */
const ENGINE_TIMEOUT_MS = 3_000;

// The engine signed in with the admin token, like the web app's server: the room lists, and the admin actions.
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
		log.warn({ msg: 'live tables: room list unreachable', key, err });
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

/** The admin actions every game's room actor has; the room checks the admin token it is sent. */
type AdminRoom = {
	adminKick(input: { seat: number; reason: string }): Promise<KickResult>;
	adminTerminate(input: { reason: string }): Promise<TerminateResult>;
};

// The rooms are reached with the admin token as connection params, the only proof of an admin a room accepts.
const ADMIN_PARAMS = { params: { adminKey: RIVET_TOKEN } };

/** Each game's room actor, by game slug. `get`, not `getOrCreate`: an admin action never makes a room. */
const ROOMS = new Map<string, (code: string) => AdminRoom>([
	['bust-31', (code) => engine.bust31Room.get([code], ADMIN_PARAMS) as unknown as AdminRoom],
	['cloudburst', (code) => engine.cloudburstRoom.get([code], ADMIN_PARAMS) as unknown as AdminRoom]
]);

export const ROOM_CODE = /^[A-Z0-9]{4,8}$/;

/** Longest reason an admin may give; the rooms refuse longer ones too. */
export const REASON_MAX = 200;

/** Why an admin action on a table failed, in words for the admin. */
export class TableActionError extends Error {}

/** The room's answer, or a TableActionError with the room's own message (a rule) or a generic one (no answer). */
async function askRoom<T>(
	game: string,
	code: string,
	ask: (room: AdminRoom) => Promise<T>
): Promise<T> {
	const room = ROOMS.get(game);
	if (!room || !ROOM_CODE.test(code)) {
		throw new TableActionError('That table does not exist.');
	}

	try {
		return await withTimeout(ask(room(code)));
	} catch (err) {
		log.warn({ msg: 'live tables: admin action failed', game, code, err });
		// A rule the room enforces (a UserError, group "user") is worded for people; anything else is not shown.
		const fromRoom = err instanceof ActorError && err.group === 'user' ? err.message : null;
		throw new TableActionError(fromRoom ?? 'The table did not answer. Refresh and try again.');
	}
}

/** The platform's row for a room, for the audit log. Null if the platform never made it. */
async function roomId(sql: SQL, game: string, code: string): Promise<string | null> {
	const [row] = await sql`
		SELECT id
		FROM rooms
		WHERE code = ${code}
			AND game_slug = ${game}`;

	return row?.id ?? null;
}

/** Terminates the table (see the room's terminateTable) and writes it to the audit log. */
export async function terminateLiveTable(
	sql: SQL,
	admin: Admin,
	target: { game: string; code: string; reason: string },
	ip: string | null
): Promise<TerminateResult> {
	const { game, code, reason } = target;
	const result = await askRoom(game, code, (room) => room.adminTerminate({ reason }));

	await audit(sql, {
		adminId: admin.id,
		action: 'room.terminate',
		roomId: await roomId(sql, game, code),
		detail: { game, code, reason, ...result },
		ip
	});

	return result;
}

/** Kicks the player in `seat` (see the room's kickFromTable) and writes it to the audit log. */
export async function kickFromLiveTable(
	sql: SQL,
	admin: Admin,
	target: { game: string; code: string; seat: number; reason: string },
	ip: string | null
): Promise<KickResult> {
	const { game, code, seat, reason } = target;
	const result = await askRoom(game, code, (room) => room.adminKick({ seat, reason }));

	await audit(sql, {
		adminId: admin.id,
		action: 'room.kick',
		playerId: isUuid(result.playerId) ? result.playerId : null,
		roomId: await roomId(sql, game, code),
		detail: { game, code, reason, ...result },
		ip
	});

	return result;
}
