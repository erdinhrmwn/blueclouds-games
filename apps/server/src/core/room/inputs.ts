// Layer 3, room: what players and the backoffice may send a room, validated before anything else runs.

import { SEATS } from 'contracts/rooms/room'
import { z } from 'zod'

/** Sent by the browser as connection params: a play token from the platform (who you are, and your name). */
export const PlayerParams = z.object({ playToken: z.string().min(1).max(2048) })

/** Sent by the backoffice's server: the engine's admin token, which only servers hold. */
export const AdminParams = z.object({ adminKey: z.string().min(32).max(512) })

/** What an admin terminating a table or kicking a player says about why; it goes to the audit and match logs. */
export const AdminReason = z.string().trim().min(1).max(200)

export const AdminTerminateInput = z.object({ reason: AdminReason })

export const BotIdInput = z.string().min(1).max(64)
export const SeatInput = z
  .number()
  .int()
  .min(0)
  .max(SEATS - 1)

export const AdminKickInput = z.object({ seat: SeatInput, reason: AdminReason })
