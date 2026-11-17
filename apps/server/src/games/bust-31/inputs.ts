// Bust 31, layer 3 (room): a player's move as sent by the browser, validated into the game's Action.

import { UserError } from 'rivetkit'
import { z } from 'zod'
import type { Action } from './domain'

export const PlayInput = z.object({ cardId: z.string().min(1).max(16) })

export function parsePlay(input: unknown): Action {
  const parsed = PlayInput.safeParse(input)
  if (!parsed.success) {
    throw new UserError('Invalid card.', { code: 'bad_input' })
  }

  return { type: 'play', cardId: parsed.data.cardId }
}
