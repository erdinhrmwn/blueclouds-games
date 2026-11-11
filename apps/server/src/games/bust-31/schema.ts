import { z } from "zod";
import { MAX_PLAYERS } from "./rules";

/** Sent by the browser as connection params; the token is the player's secret. */
export const ConnParams = z.object({
	token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
	name: z.string().trim().min(1).max(20),
});
export type ConnParams = z.infer<typeof ConnParams>;

export const PlayInput = z.object({ cardId: z.string().min(1).max(16) });
export const BotIdInput = z.string().min(1).max(64);
export const SeatInput = z.number().int().min(0).max(MAX_PLAYERS - 1);

/** Room codes are the actor key: short, uppercase, easy to read aloud. */
export const RoomCode = z.string().regex(/^[A-Z0-9]{4,8}$/);

/** What the room list shows about one table. Sent by room actors to the directory. */
export const RoomSummary = z.object({
	code: RoomCode,
	host: z.string().max(20).nullable(),
	players: z.number().int().min(0).max(MAX_PLAYERS),
	maxPlayers: z.number().int().min(1).max(MAX_PLAYERS),
	phase: z.enum(["lobby", "playing", "finished"]),
});
export type RoomSummary = z.infer<typeof RoomSummary>;
