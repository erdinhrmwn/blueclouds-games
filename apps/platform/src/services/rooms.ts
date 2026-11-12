import type { SQL } from "bun";
import { ApiError } from "../lib/http";
import { closeRoom } from "./tournaments";

/** No 0/O or 1/I, so a code read aloud or copied by hand stays right. */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * 32^8 ≈ 1.1 trillion codes, so with codes never reused a retry is still rare at 10 million rooms
 * and a random guess almost never hits a live table. Rooms made with shorter codes stay valid (4–8 chars).
 */
const CODE_LENGTH = 8;
const CODE_TRIES = 5;

/** 128 random bits. */
const INVITE_TOKEN_BYTES = 16;

/** 32 divides 256, so `byte % 32` has no bias. */
function randomCode(length: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
}

export const newRoomCode = () => randomCode(CODE_LENGTH);

/** An invite link carries 128 random bits as 32 hex characters (no symbols), so it can't be guessed. */
function newInviteToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(INVITE_TOKEN_BYTES));
	return Buffer.from(bytes).toString("hex");
}

export type Room = { id: string; code: string; game: string };
export type Visibility = "public" | "private";

type Access = {
	id: string;
	code: string;
	game: string;
	visibility: string;
	tournament: { name: string; startsAt: string } | null;
	opener: boolean;
};

const toIso = (date: Date | null) => date?.toISOString() ?? null;

/** Inserts a room with a fresh code, retrying on the rare collision. Without `visibility` it is private. */
export async function insertRoom(
	sql: SQL,
	room: {
		game: string;
		visibility?: Visibility;
		tournamentId?: string;
		playerId?: string;
		adminId?: string | null;
	},
): Promise<Room> {
	const visibility = room.visibility ?? "private";
	const tournamentId = room.tournamentId ?? null;
	const playerId = room.playerId ?? null;
	const adminId = room.adminId ?? null;

	for (let i = 0; i < CODE_TRIES; i++) {
		const [row] = await sql`
			INSERT INTO rooms (
				game_slug, code, visibility, tournament_id, created_by_player_id, created_by_admin_id
			)
			VALUES (${room.game}, ${newRoomCode()}, ${visibility}, ${tournamentId}, ${playerId}, ${adminId})
			ON CONFLICT (code) DO NOTHING
			RETURNING id, code, game_slug AS game`;

		if (row) return row as Room;
	}

	throw new Error(`no free room code after ${CODE_TRIES} tries`);
}

/**
 * The room behind a code, if this player may enter it; throws otherwise. A tournament room lets in only its
 * assigned players (also after it closed, to see how it ended), and nobody once its tournament was cancelled.
 * A private room lets in its opener and players who redeemed an invite.
 */
export async function enterable(sql: SQL, code: string, playerId: string): Promise<Access> {
	const [row] = await sql`
		SELECT
			r.id,
			r.code,
			r.game_slug AS game,
			r.visibility,
			r.created_by_player_id = ${playerId} AS opener,
			t.name,
			t.starts_at,
			t.cancelled_at,
			EXISTS (
				SELECT 1 FROM room_assignments ra
				WHERE ra.room_id = r.id AND ra.player_id = ${playerId}
			) AS assigned,
			EXISTS (
				SELECT 1 FROM room_members rm
				WHERE rm.room_id = r.id AND rm.player_id = ${playerId}
			) AS member
		FROM rooms r
		LEFT JOIN tournaments t ON t.id = r.tournament_id
		WHERE r.code = ${code}`;

	if (!row) {
		throw new ApiError("not_found", 404, "There is no table with that code.");
	}

	const isTournamentRoom = !!row.name;
	if (isTournamentRoom) {
		if (row.cancelled_at) {
			throw new ApiError("forbidden", 403, `${row.name} was cancelled.`);
		}
		if (!row.assigned) {
			throw new ApiError("forbidden", 403, `This table is for players of ${row.name}.`);
		}
	} else if (row.visibility === "private" && !row.member) {
		throw new ApiError(
			"forbidden",
			403,
			"This table is private. Ask a player there for an invite.",
		);
	}

	const tournament = isTournamentRoom
		? { name: row.name, startsAt: row.starts_at.toISOString() }
		: null;

	return {
		id: row.id,
		code: row.code,
		game: row.game,
		visibility: row.visibility,
		tournament,
		opener: !!row.opener,
	};
}

/** The room's live link, made on first ask. Two players asking at once both get the one that won. */
async function inviteLink(sql: SQL, roomId: string, playerId: string): Promise<string> {
	for (let i = 0; i < CODE_TRIES; i++) {
		const [live] = await sql`
			SELECT secret
			FROM room_invites
			WHERE room_id = ${roomId} AND revoked_at IS NULL`;

		if (live) return live.secret;

		const [made] = await sql`
			INSERT INTO room_invites (room_id, secret, created_by_player_id)
			VALUES (${roomId}, ${newInviteToken()}, ${playerId})
			ON CONFLICT DO NOTHING
			RETURNING secret`;

		if (made) return made.secret;
	}

	throw new Error(`no invite link after ${CODE_TRIES} tries`);
}

/** A player opens a new table: the platform picks its code. The opener is its first member. */
export async function openRoom(sql: SQL, game: string, visibility: Visibility, playerId: string) {
	const [known] = await sql`SELECT 1 FROM games WHERE slug = ${game}`;
	if (!known) {
		throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
	}

	const room = await sql.begin(async (tx) => {
		const made = await insertRoom(tx, { game, visibility, playerId });
		await tx`INSERT INTO room_members (room_id, player_id) VALUES (${made.id}, ${playerId})`;

		return made;
	});

	return { ...room, visibility };
}

/**
 * Anyone who may enter an open table can invite: they get the room's live link, made on first ask.
 * Tournament tables have no invites.
 */
export async function createInvite(sql: SQL, code: string, playerId: string) {
	const room = await enterable(sql, code, playerId);
	if (room.tournament) {
		throw new ApiError("forbidden", 403, "Tournament tables can't be shared.");
	}

	const token = await inviteLink(sql, room.id, playerId);
	return { token };
}

/** The opener kills the live link (e.g. it was passed on too far). The next ask for a link makes a new one. */
export async function resetInviteLink(sql: SQL, code: string, playerId: string): Promise<void> {
	const room = await enterable(sql, code, playerId);
	if (!room.opener) {
		throw new ApiError(
			"forbidden",
			403,
			"Only the player who opened this table can reset its link.",
		);
	}

	await sql`
		UPDATE room_invites
		SET revoked_at = now()
		WHERE room_id = ${room.id} AND revoked_at IS NULL`;
}

/** A link token: the player becomes a member of its room and gets the room to go to. */
export async function redeemInvite(sql: SQL, invite: string, playerId: string) {
	const [row] = await sql`
		SELECT r.id, r.code, r.game_slug AS game
		FROM room_invites i
		JOIN rooms r ON r.id = i.room_id
		WHERE i.secret = ${invite}
			AND i.revoked_at IS NULL
			AND r.tournament_id IS NULL`;

	if (!row) {
		throw new ApiError("not_found", 404, "That invite doesn't work anymore. Ask for a new one.");
	}

	await sql`
		INSERT INTO room_members (room_id, player_id)
		VALUES (${row.id}, ${playerId})
		ON CONFLICT DO NOTHING`;

	return { code: row.code as string, game: row.game as string };
}

/** For the room actor: its tournament, start time and who sits where. */
export async function roomSeats(sql: SQL, code: string) {
	const [row] = await sql`
		SELECT
			r.code,
			r.game_slug AS game,
			r.visibility,
			r.started_at,
			r.closed_at,
			t.id AS tournament_id,
			t.name,
			t.starts_at,
			t.cancelled_at,
			g.min_players
		FROM rooms r
		JOIN games g ON g.slug = r.game_slug
		LEFT JOIN tournaments t ON t.id = r.tournament_id
		WHERE r.code = ${code}`;

	if (!row) {
		throw new ApiError("not_found", 404, "There is no table with that code.");
	}

	const seats = row.tournament_id
		? await sql`
				SELECT ra.player_id AS "playerId", ra.seat
				FROM room_assignments ra
				JOIN rooms r ON r.id = ra.room_id
				WHERE r.code = ${code}
				ORDER BY ra.seat`
		: [];

	const tournament = row.tournament_id
		? {
				id: row.tournament_id,
				name: row.name,
				startsAt: toIso(row.starts_at),
				cancelled: !!row.cancelled_at,
			}
		: null;

	return {
		code: row.code,
		game: row.game,
		visibility: row.visibility,
		minPlayers: row.min_players,
		startedAt: toIso(row.started_at),
		closedAt: toIso(row.closed_at),
		tournament,
		seats: [...seats],
	};
}

/** The tournament room's match began. Idempotent. */
export async function startRoom(sql: SQL, code: string) {
	const [row] = await sql`
		UPDATE rooms
		SET started_at = coalesce(started_at, now())
		WHERE code = ${code} AND tournament_id IS NOT NULL
		RETURNING started_at`;

	if (!row) {
		throw new ApiError("not_found", 404, "There is no tournament table with that code.");
	}

	return { code, startedAt: row.started_at.toISOString() as string };
}

/** The tournament room gave up: not enough players showed up. Idempotent. */
export async function closeTournamentRoom(
	sql: SQL,
	code: string,
	reason: "not_enough_players",
): Promise<void> {
	await sql.begin(async (tx) => {
		const [room] = await tx`
			SELECT id
			FROM rooms
			WHERE code = ${code} AND tournament_id IS NOT NULL`;

		if (!room) {
			throw new ApiError("not_found", 404, "There is no tournament table with that code.");
		}

		await closeRoom(tx, room.id, reason);
	});
}
