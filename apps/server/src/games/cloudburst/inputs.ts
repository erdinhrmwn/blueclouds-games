// Cloudburst, layer 3 (room): a player's moves as sent by the browser, validated into the game's Action.

import { SUITS } from 'contracts/rooms/cloudburst'
import { UserError } from 'rivetkit'
import { z } from 'zod'
import type { Action } from './domain'

export const PlayInput = z.object({
  cardId: z.string().min(1).max(24),
  suit: z.enum(SUITS).optional(),
  giveId: z.string().min(1).max(24).optional(),
})

export function parsePlay(input: unknown): Action {
  const parsed = PlayInput.safeParse(input)
  if (!parsed.success) {
    throw new UserError('Invalid move.', { code: 'bad_input' })
  }

  return { type: 'play', input: parsed.data }
}

export const parseDraw = (): Action => ({ type: 'draw' })

export const parsePass = (): Action => ({ type: 'pass' })
