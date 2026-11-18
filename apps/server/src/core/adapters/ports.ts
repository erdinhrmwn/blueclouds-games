// Layer 4, adapter: the real ports of one room actor, from its context (its SQLite and its Rivet client).

import type { RoomPorts } from '../domain/ports'
import { httpPlatform } from './platform'
import { type RoomListClient, rivetRoomLists } from './room-lists'
import { type SqlDatabase, sqliteRoomStore } from './room-store'

/** The parts of a Rivet actor context the adapters are built from. */
export interface AdapterCtx {
  readonly db: SqlDatabase
  client(): RoomListClient
}

export function roomPorts(c: AdapterCtx): RoomPorts {
  return {
    platform: httpPlatform,
    store: sqliteRoomStore(c.db),
    lists: rivetRoomLists(c.client()),
  }
}
