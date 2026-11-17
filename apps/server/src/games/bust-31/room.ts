// Bust 31, layer 3 (room): the room actor. Everything but the game's own move comes from createRoom.

import { createRoom } from '../../core/room/create-room'
import { bust31 } from './definition'
import { parsePlay } from './inputs'

export const bust31Room = createRoom(bust31, (room) => ({
  /** Plays a card from your hand. */
  play: room.move(parsePlay),
}))
