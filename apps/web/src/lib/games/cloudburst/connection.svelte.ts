import type { Actions, Hand, PlayInput, View } from 'contracts/rooms/cloudburst'
import { RoomConnection } from '#lib/rivet/room.svelte.ts'

/** A Cloudburst room: the shared actions plus play, draw and pass. */
export class CloudburstConnection extends RoomConnection<View, Hand, Actions> {
  constructor(code: string) {
    super('cloudburst', 'cloudburstRoom', code, { cards: [], drawnId: null })
  }
  play = (input: PlayInput) => this.call('play', input)
  draw = () => this.call('draw')
  pass = () => this.call('pass')
}
