import type { Actions, Hand, View } from 'contracts/rooms/bust-31'
import { RoomConnection } from '#lib/rivet/room.svelte.ts'

/** A Bust 31 room: the shared actions plus playing a card. */
export class Bust31Connection extends RoomConnection<View, Hand, Actions> {
  constructor(code: string) {
    super('bust-31', 'bust31Room', code, [])
  }
  play = (cardId: string) => this.call('play', { cardId })
}
