// Layer 3, room: a room's state in `c.vars`, new or loaded from its store.

import type { MatchState } from '../domain/match'
import type { RoomStorePort } from '../domain/ports'
import type { RoomVars, SavedRoom } from '../domain/room'
import type { GameTable } from '../domain/table'
import { newCommitment } from '../rules/fair-rng'
import type { RoomCtx } from './context'

/** A new room around `game`, committed to its first match. */
export function roomVars<G extends GameTable, M extends MatchState>(game: G): RoomVars<G, M> {
  return {
    game,
    logged: game,
    who: {},
    vipCheckAt: null,
    timer: null,
    match: null,
    kicked: [],
    terminated: null,
    next: newCommitment(),
    fairLog: [],
  }
}

/** onWake: loads the saved room into `c.vars`, filling in what a room saved by older code misses. */
export async function loadRoom<G extends GameTable, M extends MatchState>(
  c: RoomCtx<G, M>,
  store: RoomStorePort,
): Promise<void> {
  // The store hands back what was saved, as it was saved: an older save may miss any optional field.
  const saved = (await store.loadRoom()) as Partial<SavedRoom<G, M>> | null
  if (saved) {
    Object.assign(c.vars, saved)
  }

  const vars = c.vars
  vars.timer ??= null
  vars.match ??= null
  vars.kicked ??= []
  vars.terminated ??= null

  // A room saved before seeds were made per round commits again; a match it was playing deals on unseeded.
  if (!vars.next?.firstRound) {
    vars.next = newCommitment()
  }

  if (vars.match?.seeds && !vars.match.seeds.next) {
    vars.match.seeds = undefined
  }

  vars.fairLog = []

  // Matches started before the move log have no seq yet.
  if (vars.match) {
    vars.match.seq ??= 0
  }

  vars.logged = vars.game
}

/** What a commit saves of the room. */
export function savedRoom<G extends GameTable, M extends MatchState>(
  vars: RoomVars<G, M>,
): SavedRoom<G, M> {
  return {
    game: vars.game,
    timer: vars.timer,
    match: vars.match,
    tournament: vars.tournament,
    listed: vars.listed,
    kicked: vars.kicked,
    terminated: vars.terminated,
    next: vars.next,
    lastMatchId: vars.lastMatchId ?? null,
    roomName: vars.roomName ?? null,
  }
}
