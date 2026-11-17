// Compile-time proof that the actors keep their contracts (contracts/rooms): web and the backoffice read the
// rooms through those types only. Nothing runs here; `bun run check` fails when an actor drifts.
import type * as Bust31 from 'contracts/rooms/bust-31'
import type * as Cloudburst from 'contracts/rooms/cloudburst'
import type { AdminActions, RoomListActions, RoomSummary } from 'contracts/rooms/room'
import type { ActorConn } from 'rivetkit/client'
import type { bust31Room } from './games/bust-31/actor'
import type { cloudburstRoom } from './games/cloudburst/actor'
import type { roomList } from './games/shared/directory'
import type { RoomSummary as ReportedSummary } from './games/shared/schema'

/** Fails to compile unless `Actual` offers everything `Contract` promises. */
type Keeps<Contract, Actual extends Contract> = Actual

export type Checks = [
  Keeps<Bust31.Actions & AdminActions, ActorConn<typeof bust31Room>>,
  Keeps<Cloudburst.Actions & AdminActions, ActorConn<typeof cloudburstRoom>>,
  Keeps<RoomListActions, ActorConn<typeof roomList>>,
  // What rooms report to the list is what the list hands out.
  Keeps<RoomSummary, ReportedSummary>,
  Keeps<ReportedSummary, RoomSummary>,
]
