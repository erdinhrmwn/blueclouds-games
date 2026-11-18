// Layer 2, rules: what the table shows about the room around the game (turn clock, tournament, fairness), from the
// room's state. Pure.

import { clientSeedOf } from 'contracts/fairness/fairness'
import type { FairnessView, TournamentView, TurnClock } from 'contracts/rooms/room'
import type { MatchId } from '../domain/ids'
import type { MatchState } from '../domain/match'
import type { NextMatch, TournamentRoom, TurnTimer } from '../domain/room'
import { LATE_GRACE_MS } from './tournament'

/** The turn clock as clients get it: relative, so a wrong device clock still counts down correctly. */
export function turnClock(timer: TurnTimer | null, now: number): TurnClock | null {
  if (!timer) {
    return null
  }

  return {
    left: Math.max(0, timer.endsAt - now),
    total: timer.total,
  }
}

/** The tournament part of the view. Times are relative, like the turn clock. */
export function tournamentView(
  tournament: TournamentRoom | null | undefined,
  now: number,
): TournamentView | null {
  if (!tournament) {
    return null
  }

  return {
    id: tournament.id,
    name: tournament.name,
    format: tournament.format ?? null,
    rounds: tournament.rounds ?? null,
    registered: tournament.registered ?? null,
    round: tournament.round,
    startsIn: tournament.startsAt - now,
    waitEndsIn: tournament.startsAt + LATE_GRACE_MS - now,
    seats: Object.keys(tournament.seats).length,
    closed: tournament.closed,
  }
}

/** The part of the room fairness is shown from. */
export interface FairnessState {
  match: MatchState | null
  next: NextMatch
  lastMatchId?: MatchId | null
}

/**
 * What the table shows about fairness: the hash of the round being played (in the lobby: of the next match's
 * first round) and of the round after it, both locked in before they are dealt; while a match is played also its
 * id, its round and the client seed of its last shuffle. Each seed is revealed when its round closes. Null for a
 * match started before provably fair shuffles.
 */
export function fairnessView(room: FairnessState): FairnessView | null {
  const lastMatchId = room.lastMatchId ?? null

  if (!room.match) {
    return {
      matchId: null,
      lastMatchId,
      round: 1,
      serverSeedHash: room.next.firstRound.serverSeedHash,
      clientSeed: null,
      nextServerSeedHash: null,
    }
  }

  const seeds = room.match.seeds
  if (!seeds?.current) {
    return null
  }

  const clientSeed = seeds.last ? clientSeedOf(seeds.matchId, seeds.last) : null

  return {
    matchId: seeds.matchId,
    lastMatchId,
    round: seeds.current.round,
    serverSeedHash: seeds.current.serverSeedHash,
    clientSeed,
    nextServerSeedHash: seeds.next.serverSeedHash,
  }
}
