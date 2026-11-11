import { z } from "zod";

/** Sent by the browser as connection params; the token is the player's secret. */
export const ConnParams = z.object({
	token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
	name: z.string().trim().min(1).max(20),
});
export type ConnParams = z.infer<typeof ConnParams>;

export const PlayInput = z.object({ cardId: z.string().min(1).max(16) });
export const BotIdInput = z.string().min(1).max(64);

/** Room codes are the actor key: short, uppercase, easy to read aloud. */
export const RoomCode = z.string().regex(/^[A-Z0-9]{4,8}$/);
