// Layer 3, room: the parts of a Rivet actor context the room layer uses. Rivet's own contexts fit these
// interfaces, so the actors pass `c` as it is; tests pass small fakes.

import type { MatchState } from '../domain/match'
import type { RoomVars } from '../domain/room'
import type { GameTable } from '../domain/table'

/** One open connection to the room: a player's browser, or the backoffice's server. */
export interface RoomConn {
  readonly id: string
  readonly params: unknown
  send(event: string, ...args: unknown[]): void
  disconnect(reason?: string): unknown
}

/** Runs one of the room's own actions later, also after the actor slept. */
export interface RoomSchedule {
  after(duration: number, action: string, ...args: unknown[]): Promise<unknown>
  at(timestamp: number, action: string, ...args: unknown[]): Promise<unknown>
}

export interface RoomLog {
  info(entry: Record<string, unknown>): void
  warn(entry: Record<string, unknown>): void
  error(entry: Record<string, unknown>): void
}

/** Any room context: lifecycle hooks (wake, connect, disconnect) and actions alike. */
export interface RoomCtx<G extends GameTable = GameTable, M extends MatchState = MatchState> {
  vars: RoomVars<G, M>
  /** `[room code]`. */
  readonly key: string[]
  readonly conns: ReadonlyMap<string, RoomConn>
  readonly schedule: RoomSchedule
  readonly log: RoomLog
  broadcast(event: string, ...args: unknown[]): void
}

/** An action's context: who called, and whether the scheduler did. */
export interface ActionCtx<
  G extends GameTable = GameTable,
  M extends MatchState = MatchState,
> extends RoomCtx<G, M> {
  readonly conn: RoomConn
  /** Set when the scheduler (not a connection) called the action. */
  readonly scheduledFire?: unknown
}

/** The room's code: its actor key. */
export const roomCode = (c: RoomCtx): string => c.key[0] ?? ''
