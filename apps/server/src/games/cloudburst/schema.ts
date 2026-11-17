import { SUITS } from 'contracts/rooms/cloudburst'
import { z } from 'zod'

export const PlayInput = z.object({
  cardId: z.string().min(1).max(24),
  suit: z.enum(SUITS).optional(),
  giveId: z.string().min(1).max(24).optional(),
})
