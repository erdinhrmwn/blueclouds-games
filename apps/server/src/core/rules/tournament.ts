// Layer 2, rules: a tournament table as the room knows it, from what the platform says about the room. Pure.

import type { PlatformRoom } from '../domain/ports'
import type { TournamentRoom } from '../domain/room'

/** How long a tournament room waits past its start time for late players (Erdin, 2026-11-11). */
export const LATE_GRACE_MS = 3 * 60_000

/** What the platform's answer says about a room: its tournament (null = open table), listing and name. */
export interface RoomFacts {
  tournament: TournamentRoom | null
  /** In its game's public list of open tables. */
  listed: boolean
  roomName: string | null
}

/**
 * The room's facts from the platform's answer (null = the platform doesn't know the room). A table closed once
 * stays closed, even if the platform has not recorded it yet.
 */
export function roomFacts(
  room: PlatformRoom | null,
  known: TournamentRoom | null | undefined,
): RoomFacts {
  const tournament = room?.tournament
  const roomName = room?.name ?? null

  if (!room || !tournament) {
    return {
      tournament: null,
      listed: room?.visibility === 'public',
      roomName,
    }
  }

  const seats = Object.fromEntries(room.seats.map((seat) => [seat.playerId, seat.seat]))
  const bots = Object.fromEntries(
    room.seats.filter((seat) => seat.bot).map((seat) => [seat.playerId, seat.name || 'Bot']),
  )

  return {
    listed: false,
    roomName,
    tournament: {
      bots,
      id: tournament.id,
      name: tournament.name,
      format: tournament.format,
      rounds: tournament.rounds,
      registered: tournament.registered,
      round: tournament.round,
      startsAt: Date.parse(tournament.startsAt),
      cancelled: tournament.cancelled,
      minPlayers: room.minPlayers,
      seats,
      closed: !!known?.closed || !!room.closedAt,
    },
  }
}
