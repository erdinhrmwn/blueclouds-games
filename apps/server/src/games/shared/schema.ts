import { z } from "zod";
import { SEATS } from "./table";

/** Sent by the browser as connection params: a play token from the platform (who you are, and your name). */
export const PlayerParams = z.object({ playToken: z.string().min(1).max(2048) });

/** Sent by the backoffice's server: the engine's admin token, which only servers hold. */
export const AdminParams = z.object({ adminKey: z.string().min(32).max(512) });

/** What an admin terminating a table or kicking a player says about why; it goes to the audit and match logs. */
export const AdminReason = z.string().trim().min(1).max(200);

export const AdminTerminateInput = z.object({ reason: AdminReason });

export const BotIdInput = z.string().min(1).max(64);
export const SeatInput = z
	.number()
	.int()
	.min(0)
	.max(SEATS - 1);

export const AdminKickInput = z.object({ seat: SeatInput, reason: AdminReason });

/** Room codes are the actor key: short, uppercase, easy to read aloud. */
export const RoomCode = z.string().regex(/^[A-Z0-9]{4,8}$/);

/** Game slugs key the room lists, one list per game. */
export const GameSlug = z.string().regex(/^[a-z0-9-]{1,32}$/);

/**
 * Tournament tables report to their own list per game, read only by the backoffice: the public list (keyed by the
 * bare slug) never shows them.
 */
export const tournamentListKey = (slug: string) => `${slug}:tournament`;

/** Who sits in one seat, for the backoffice's Live tables. No ids: the list is read by servers only. */
export const SeatSummary = z.object({
	seat: SeatInput,
	name: z.string().max(20),
	bot: z.boolean(),
});
export type SeatSummary = z.infer<typeof SeatSummary>;

/** What the room list shows about one table. Sent by room actors to their game's list. */
export const RoomSummary = z.object({
	code: RoomCode,
	/** The table's own name; rooms running older code send none. */
	name: z.string().max(32).nullable().default(null),
	host: z.string().max(20).nullable(),
	players: z.number().int().min(0).max(SEATS),
	maxPlayers: z.number().int().min(1).max(SEATS),
	phase: z.enum(["lobby", "playing", "finished"]),
	// Rooms running older code don't send seats or the round yet.
	seats: z.array(SeatSummary).max(SEATS).default([]),
	/** 0 before the first deal. */
	round: z.number().int().min(0).max(10_000).default(0),
});
export type RoomSummary = z.infer<typeof RoomSummary>;
