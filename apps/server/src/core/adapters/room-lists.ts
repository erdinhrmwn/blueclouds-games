// Layer 4, adapter: RoomListPort over the room list actors (src/room-list.ts), reached through the actor's own
// Rivet client.

import type { RoomSummary } from 'contracts/rooms/room'
import type { RoomListPort } from '../domain/ports'

/** The room list actor as a room calls it. */
interface RoomListHandle {
  report(summary: RoomSummary): Promise<unknown>
  remove(code: string): Promise<unknown>
}

/** The part of an actor's `c.client()` used here. */
export interface RoomListClient {
  roomList: {
    getOrCreate(key: string[]): RoomListHandle
  }
}

export function rivetRoomLists(client: RoomListClient): RoomListPort {
  return {
    report: async (listKey, summary) => {
      await client.roomList.getOrCreate([listKey]).report(summary)
    },
    remove: async (listKey, code) => {
      await client.roomList.getOrCreate([listKey]).remove(code)
    },
  }
}
