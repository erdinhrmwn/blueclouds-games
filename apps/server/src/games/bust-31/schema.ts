import { z } from "zod";

export const PlayInput = z.object({ cardId: z.string().min(1).max(16) });
