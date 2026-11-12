import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { playerAuth, type PlayerVariables, serverAuth } from "./auth";
import { ApiError, ok, parse, readJson } from "./http";
import { rateLimit } from "./rate-limit";
import { closeRoom } from "./tournaments";

/** No 0/O or 1/I, so a code read aloud or copied by hand stays right. */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/**
 * 32^8 ≈ 1.1 trillion codes, so with codes never reused a retry is still rare at 10 million rooms
 * and a random guess almost never hits a live table. Rooms made with shorter codes stay valid (4–8 chars).
 */
const CODE_LENGTH = 8;
const CODE_TRIES = 5;
/** Players open tables, so it is rate-limited like guest sign-ups, a bit looser. */
const ROOM_LIMIT = { perIp: 20, windowMs: 60_000 };

/** Room codes and invite codes use the same readable alphabet. 32 divides 256, so `b % 32` has no bias. */
const randomCode = (length: number) => Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

export const newRoomCode = () => randomCode(CODE_LENGTH);

/**
 * An invite code is typed by hand, so it is short and lasts only a few minutes; redeeming is rate-limited per IP.
 * ponytail: codes stay unique forever (32^6 ≈ 1 billion), so a retry is rare for years. If room_invites
 * passes ~10 million rows, sweep expired codes.
 */
const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_TTL_MS = 10 * 60_000;
/** An invite link carries 128 random bits as 32 hex characters (no symbols), so it can't be guessed. */
const newInviteToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
/** Making and redeeming invites, per IP. Redeeming is the tight one: it is where a code could be guessed. */
const INVITE_LIMIT = { perIp: 20, windowMs: 60_000 };
const REDEEM_LIMIT = { perIp: 10, windowMs: 60_000 };

const Game = z.string().regex(/^[a-z0-9-]{2,32}$/, "Unknown game.");
const Visibility = z.enum(["public", "private"]);
const NewRoom = z.object({ game: Game, visibility: Visibility.default("private") });
const Code = z.string().regex(/^[A-Z0-9]{4,8}$/, "Not a room code.");
const NewInvite = z.object({ kind: z.enum(["link", "code"]) });
const Redeem = z.object({ invite: z.string().trim().regex(/^[A-Za-z0-9]{6,64}$/, "That invite doesn't look right.") });

export type Room = { id: string; code: string; game: string };

/** Inserts a room with a fresh code, retrying on the rare collision. Without `visibility` it is private. */
export async function insertRoom(
	sql: SQL,
	room: { game: string; visibility?: "public" | "private"; tournamentId?: string; playerId?: string; adminId?: string | null },
): Promise<Room> {
	for (let i = 0; i < CODE_TRIES; i++) {
		const [row] = await sql`
			INSERT INTO rooms (game_slug, code, visibility, tournament_id, created_by_player_id, created_by_admin_id)
			VALUES (${room.game}, ${newRoomCode()}, ${room.visibility ?? "private"}, ${room.tournamentId ?? null}, ${room.playerId ?? null}, ${room.adminId ?? null})
			ON CONFLICT (code) DO NOTHING RETURNING id, code, game_slug AS game`;
		if (row) return row as Room;
	}
	throw new Error(`no free room code after ${CODE_TRIES} tries`);
}

type Access = { id: string; code: string; game: string; visibility: string; tournament: { name: string; startsAt: string } | null; opener: boolean };

/**
 * The room behind a code, if this player may enter it; throws otherwise. A tournament room lets in only its
 * assigned players (also after it closed, to see how it ended), and nobody once its tournament was cancelled.
 * A private room lets in its opener and players who redeemed an invite.
 */
async function enterable(sql: SQL, code: string, playerId: string): Promise<Access> {
	const [row] = await sql`
		SELECT r.id, r.code, r.game_slug AS game, r.visibility, r.created_by_player_id = ${playerId} AS opener,
		       t.name, t.starts_at, t.cancelled_at,
		       EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id = r.id AND ra.player_id = ${playerId}) AS assigned,
		       EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.player_id = ${playerId}) AS member
		FROM rooms r LEFT JOIN tournaments t ON t.id = r.tournament_id WHERE r.code = ${code}`;
	if (!row) throw new ApiError("not_found", 404, "There is no table with that code.");
	if (row.name) {
		if (row.cancelled_at) throw new ApiError("forbidden", 403, `${row.name} was cancelled.`);
		if (!row.assigned) throw new ApiError("forbidden", 403, `This table is for players of ${row.name}.`);
	} else if (row.visibility === "private" && !row.member) {
		throw new ApiError("forbidden", 403, "This table is private. Ask a player there for an invite.");
	}
	const tournament = row.name ? { name: row.name, startsAt: row.starts_at.toISOString() } : null;
	return { id: row.id, code: row.code, game: row.game, visibility: row.visibility, tournament, opener: !!row.opener };
}

/** The room's live link, made on first ask. Two players asking at once both get the one that won. */
async function inviteLink(sql: SQL, roomId: string, playerId: string): Promise<string> {
	for (let i = 0; i < CODE_TRIES; i++) {
		const [live] = await sql`SELECT secret FROM room_invites WHERE room_id = ${roomId} AND kind = 'link' AND revoked_at IS NULL`;
		if (live) return live.secret;
		const [made] = await sql`
			INSERT INTO room_invites (room_id, kind, secret, created_by_player_id)
			VALUES (${roomId}, 'link', ${newInviteToken()}, ${playerId}) ON CONFLICT DO NOTHING RETURNING secret`;
		if (made) return made.secret;
	}
	throw new Error(`no invite link after ${CODE_TRIES} tries`);
}

/** A new invite code for the room, valid for INVITE_CODE_TTL_MS. */
async function inviteCode(sql: SQL, roomId: string, playerId: string): Promise<{ code: string; expiresAt: string }> {
	for (let i = 0; i < CODE_TRIES; i++) {
		const [made] = await sql`
			INSERT INTO room_invites (room_id, kind, secret, created_by_player_id, expires_at)
			VALUES (${roomId}, 'code', ${randomCode(INVITE_CODE_LENGTH)}, ${playerId}, now() + make_interval(secs => ${INVITE_CODE_TTL_MS / 1000}))
			ON CONFLICT (secret) DO NOTHING RETURNING secret, expires_at`;
		if (made) return { code: made.secret, expiresAt: made.expires_at.toISOString() };
	}
	throw new Error(`no free invite code after ${CODE_TRIES} tries`);
}

const CloseBody = z.object({ reason: z.literal("not_enough_players") });

export function roomRoutes(sql: SQL, serverKey: string) {
	const app = new Hono<{ Variables: PlayerVariables }>();
	const auth = playerAuth(sql);
	const server = serverAuth(serverKey);

	/** A player opens a new table: the platform picks its code. The opener is its first member. */
	app.post("/rooms", rateLimit(ROOM_LIMIT.perIp, ROOM_LIMIT.windowMs), auth, async (c) => {
		const { game, visibility } = parse(NewRoom, await readJson(c));
		const [known] = await sql`SELECT 1 FROM games WHERE slug = ${game}`;
		if (!known) throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
		const playerId = c.get("player").id;
		const room = await sql.begin(async (tx) => {
			const made = await insertRoom(tx, { game, visibility, playerId });
			await tx`INSERT INTO room_members (room_id, player_id) VALUES (${made.id}, ${playerId})`;
			return made;
		});
		return ok(c, { room: { ...room, visibility } }, 201);
	});

	/** Whether the signed-in player may enter this room. The game's server asks before it hands out a room token. */
	app.get("/rooms/:code", auth, async (c) => {
		const { opener: _, ...room } = await enterable(sql, parse(Code, c.req.param("code")), c.get("player").id);
		return ok(c, { room });
	});

	/**
	 * Anyone who may enter an open table can invite: `link` answers the room's live link (made on first ask),
	 * `code` makes a new short-lived code. Tournament tables have no invites.
	 */
	app.post("/rooms/:code/invites", rateLimit(INVITE_LIMIT.perIp, INVITE_LIMIT.windowMs), auth, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { kind } = parse(NewInvite, await readJson(c));
		const playerId = c.get("player").id;
		const room = await enterable(sql, code, playerId);
		if (room.tournament) throw new ApiError("forbidden", 403, "Tournament tables can't be shared.");
		if (kind === "link") return ok(c, { invite: { kind, token: await inviteLink(sql, room.id, playerId) } });
		return ok(c, { invite: { kind, ...(await inviteCode(sql, room.id, playerId)) } }, 201);
	});

	/** The opener kills the live link (e.g. it was passed on too far). The next ask for a link makes a new one. */
	app.delete("/rooms/:code/invites/link", auth, async (c) => {
		const room = await enterable(sql, parse(Code, c.req.param("code")), c.get("player").id);
		if (!room.opener) throw new ApiError("forbidden", 403, "Only the player who opened this table can reset its link.");
		await sql`UPDATE room_invites SET revoked_at = now() WHERE room_id = ${room.id} AND kind = 'link' AND revoked_at IS NULL`;
		return ok(c, { revoked: true });
	});

	/** A link token or a code: the player becomes a member of its room and gets the room to go to. */
	app.post("/invites/redeem", rateLimit(REDEEM_LIMIT.perIp, REDEEM_LIMIT.windowMs), auth, async (c) => {
		const { invite } = parse(Redeem, await readJson(c));
		const [row] = await sql`
			SELECT r.id, r.code, r.game_slug AS game FROM room_invites i JOIN rooms r ON r.id = i.room_id
			WHERE i.secret = ${invite} AND i.revoked_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > now()) AND r.tournament_id IS NULL`;
		if (!row) throw new ApiError("not_found", 404, "That invite doesn't work anymore. Ask for a new one.");
		await sql`INSERT INTO room_members (room_id, player_id) VALUES (${row.id}, ${c.get("player").id}) ON CONFLICT DO NOTHING`;
		return ok(c, { room: { code: row.code, game: row.game } });
	});

	/** For the room actor (server key): its tournament, start time and who sits where. */
	app.get("/rooms/:code/seats", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const [row] = await sql`
			SELECT r.code, r.game_slug AS game, r.visibility, r.started_at, r.closed_at, t.id AS tournament_id, t.name, t.starts_at, t.cancelled_at, g.min_players
			FROM rooms r JOIN games g ON g.slug = r.game_slug LEFT JOIN tournaments t ON t.id = r.tournament_id
			WHERE r.code = ${code}`;
		if (!row) throw new ApiError("not_found", 404, "There is no table with that code.");
		const seats = row.tournament_id
			? await sql`SELECT ra.player_id AS "playerId", ra.seat FROM room_assignments ra JOIN rooms r ON r.id = ra.room_id WHERE r.code = ${code} ORDER BY ra.seat`
			: [];
		const iso = (d: Date | null) => d?.toISOString() ?? null;
		return ok(c, {
			room: {
				code: row.code,
				game: row.game,
				visibility: row.visibility,
				minPlayers: row.min_players,
				startedAt: iso(row.started_at),
				closedAt: iso(row.closed_at),
				tournament: row.tournament_id
					? { id: row.tournament_id, name: row.name, startsAt: iso(row.starts_at), cancelled: !!row.cancelled_at }
					: null,
				seats: [...seats],
			},
		});
	});

	/** The tournament room's match began. Idempotent. */
	app.post("/rooms/:code/start", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const [row] = await sql`
			UPDATE rooms SET started_at = coalesce(started_at, now()) WHERE code = ${code} AND tournament_id IS NOT NULL RETURNING started_at`;
		if (!row) throw new ApiError("not_found", 404, "There is no tournament table with that code.");
		return ok(c, { room: { code, startedAt: row.started_at.toISOString() } });
	});

	/** The tournament room gave up: not enough players showed up. Idempotent. */
	app.post("/rooms/:code/close", server, async (c) => {
		const code = parse(Code, c.req.param("code"));
		const { reason } = parse(CloseBody, await readJson(c));
		await sql.begin(async (tx) => {
			const [room] = await tx`SELECT id FROM rooms WHERE code = ${code} AND tournament_id IS NOT NULL`;
			if (!room) throw new ApiError("not_found", 404, "There is no tournament table with that code.");
			await closeRoom(tx, room.id, reason);
		});
		return ok(c, { room: { code, closed: true } });
	});

	return app;
}
