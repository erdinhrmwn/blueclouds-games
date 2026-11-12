import { z } from "zod";
import { SEATS } from "./table";

/** Sent by the browser as connection params: a play token from the platform (who you are, and your name). */
export const ConnParams = z.object({ playToken: z.string().min(1).max(2048) });
export type ConnParams = z.infer<typeof ConnParams>;

export const BotIdInput = z.string().min(1).max(64);
export const SeatInput = z
	.number()
	.int()
	.min(0)
	.max(SEATS - 1);

/** Room codes are the actor key: short, uppercase, easy to read aloud. */
export const RoomCode = z.string().regex(/^[A-Z0-9]{4,8}$/);

/** Game slugs key the room lists, one list per game. */
export const GameSlug = z.string().regex(/^[a-z0-9-]{1,32}$/);

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
	host: z.string().max(20).nullable(),
	players: z.number().int().min(0).max(SEATS),
	maxPlayers: z.number().int().min(1).max(SEATS),
	phase: z.enum(["lobby", "playing", "finished"]),
	// Rooms running older code don't send seats yet.
	seats: z.array(SeatSummary).max(SEATS).default([]),
});
export type RoomSummary = z.infer<typeof RoomSummary>;
