import { z } from "zod";
import { SUITS } from "./rules";

export const PlayInput = z.object({
	cardId: z.string().min(1).max(24),
	suit: z.enum(SUITS).optional(),
	giveId: z.string().min(1).max(24).optional(),
});
