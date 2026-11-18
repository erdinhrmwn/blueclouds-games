// Layer 2, rules: which room list a table is shown in, and what its line says. Pure.

import { type RoomSummary, SEATS, tournamentListKey } from 'contracts/rooms/room'
import type { GameTable } from '../domain/table'

/** Which room list a table reports to: the public one, the backoffice's tournament one, or none (private). */
export function directoryKey(slug: string, listed: boolean, tournament: boolean): string | null {
  if (listed) {
    return slug
  }

  if (tournament) {
    return tournamentListKey(slug)
  }

  return null
}

/** The table's line in a room list. */
export function roomSummary(code: string, name: string | null, game: GameTable): RoomSummary {
  const host = game.players.find((player) => player.id === game.hostId)?.name ?? null

  return {
    code,
    name,
    host,
    players: game.players.length,
    maxPlayers: SEATS,
    phase: game.phase,
    seats: game.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      bot: player.bot,
    })),
    round: game.round,
  }
}
