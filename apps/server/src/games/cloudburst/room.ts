// Cloudburst, layer 3 (room): the room actor. Everything but the game's own moves comes from createRoom.

import { createRoom } from '../../core/room/create-room'
import { cloudburst } from './definition'
import { parseDraw, parsePass, parsePlay } from './inputs'

export const cloudburstRoom = createRoom(cloudburst, (room) => ({
  /** Plays a card: `suit` for a wild card, `giveId` (the card to hand on) for a Gust. */
  play: room.move(parsePlay),
  /** Draws one card. */
  draw: room.move(parseDraw),
  /** Ends your turn after drawing. */
  pass: room.move(parsePass),
}))
