// Layer 2, rules: the table every game shares (seats, host, away players, tags, shuffling). Pure: no Rivet,
// no I/O.

import type { Avatar } from 'contracts/avatars'
import { SEATS } from 'contracts/rooms/room'
import type { PlayerId } from '../domain/ids'
import { type Rng, RuleError, type Seated, type Table } from '../domain/table'

export function shuffle<T extends { id: string }>(items: T[], rng: Rng, round: number): T[] {
  return rng.shuffle(items, round)
}

/** A plain Fisher-Yates shuffle from `next` (a float in [0, 1)): for tests, and matches started before fairness. */
export function randomRng(next: () => number = Math.random): Rng {
  return {
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j]!, out[i]!]
      }

      return out
    },
  }
}

// Players are kept in seat order, so a turn index walks around the table.
export const bySeat = <P extends Seated>(players: P[]) =>
  [...players].sort((a, b) => a.seat - b.seat)

export function freeSeats(players: Seated[]): number[] {
  const taken = new Set(players.map((player) => player.seat))
  const allSeats = Array.from({ length: SEATS }, (_, seat) => seat)

  return allSeats.filter((seat) => !taken.has(seat))
}

function assertFreeSeat(players: Seated[], seat: number) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) {
    throw new RuleError('That seat does not exist.')
  }

  if (players.some((player) => player.seat === seat)) {
    throw new RuleError('That seat is taken.')
  }
}

/**
 * Sits `player` in `seat`, or in the first free one when no seat is given. Lobby only.
 * The first human becomes host (a bot can't be: someone has to press start).
 */
export function seatPlayer<G extends Table<P>, P extends Seated>(
  game: G,
  player: Omit<P, 'seat'>,
  seat?: number,
): G {
  if (game.phase !== 'lobby') {
    throw new RuleError('The game has already started.')
  }

  const chosen = seat ?? freeSeats(game.players)[0]
  if (chosen === undefined) {
    throw new RuleError('This table is full.')
  }

  assertFreeSeat(game.players, chosen)

  const seated = { ...player, seat: chosen } as P
  const hostId = game.hostId ?? (player.bot ? null : player.id)

  return { ...game, hostId, players: bySeat([...game.players, seated]) }
}

/** Moves a player to an empty chair. Lobby only, so the turn order never changes mid-game. */
export function takeSeat<G extends Table>(game: G, id: PlayerId, seat: number): G {
  if (game.phase !== 'lobby') {
    throw new RuleError('Seats are locked while a game is running.')
  }

  if (!game.players.some((player) => player.id === id)) {
    throw new RuleError('Join the table first.')
  }

  assertFreeSeat(game.players, seat)

  const moved = game.players.map((player) => (player.id === id ? { ...player, seat } : player))
  return { ...game, players: bySeat(moved) }
}

/** Only allowed in the lobby; mid-game seats stay so the turn order holds. */
export function removePlayer<G extends Table>(game: G, id: PlayerId): G {
  if (game.phase !== 'lobby') {
    return game
  }

  const players = game.players.filter((player) => player.id !== id)

  // The host leaving hands the table to the next human.
  let hostId = game.hostId
  if (hostId === id) {
    hostId = players.find((player) => !player.bot)?.id ?? null
  }

  return { ...game, players, hostId }
}

/**
 * Takes a kicked human off the table. In the lobby their chair empties. Mid-game the chair stays, so the turn order
 * holds, and is played for them like an away player's; going back to the lobby drops it. The host role moves on.
 */
export function kickPlayer<G extends Table>(game: G, id: PlayerId): G {
  if (game.phase === 'lobby') {
    return removePlayer(game, id)
  }

  const kicked = markAway(game, id)
  if (kicked.hostId !== id) {
    return kicked
  }

  const nextHost = kicked.players.find((player) => !player.bot && !player.away)?.id ?? null

  return { ...kicked, hostId: nextHost }
}

/** A human who closed the game mid-match: their turns are played for them until they return. */
export const markAway = <G extends Table>(game: G, id: PlayerId): G => withAway(game, id, true)

/** The away player is back and plays their own turns again. */
export const markBack = <G extends Table>(game: G, id: PlayerId): G => withAway(game, id, false)

function withAway<G extends Table>(game: G, id: PlayerId, away: boolean): G {
  return {
    ...game,
    players: game.players.map((player) =>
      player.id === id && !player.bot ? { ...player, away } : player,
    ),
  }
}

/** Shows the player as a VIP at the table. */
export function markVip<G extends Table>(game: G, id: PlayerId): G {
  return {
    ...game,
    players: game.players.map((player) => (player.id === id ? { ...player, vip: true } : player)),
  }
}

/** Shows the player's avatar. Returns the same game when it is already shown. */
export function showAvatar<G extends Table>(game: G, id: PlayerId, avatar: Avatar): G {
  const current = game.players.find((player) => player.id === id)
  if (!current) {
    return game
  }

  const same = current.avatar?.color === avatar.color && current.avatar?.icon === avatar.icon
  if (same) {
    return game
  }

  return {
    ...game,
    players: game.players.map((player) => (player.id === id ? { ...player, avatar } : player)),
  }
}

/** Shows exactly the humans in `vipIds` as VIPs. Returns the same game when no tag changes. */
export function showVips<G extends Table>(game: G, vipIds: Set<PlayerId>): G {
  const changed = game.players.some(
    (player) => !player.bot && !!player.vip !== vipIds.has(player.id),
  )
  if (!changed) {
    return game
  }

  return {
    ...game,
    players: game.players.map((player) =>
      player.bot ? player : { ...player, vip: vipIds.has(player.id) },
    ),
  }
}

/** The next index around the table in `direction` whose player `inPlay` accepts (or `from` if none does). */
export function nextIndex<P>(
  players: P[],
  from: number,
  direction: 1 | -1,
  inPlay: (p: P) => boolean = () => true,
): number {
  const count = players.length
  for (let step = 1; step <= count; step++) {
    // Wraps around both ways: ((x % n) + n) % n is never negative.
    const index = (((from + step * direction) % count) + count) % count
    if (inPlay(players[index]!)) {
      return index
    }
  }

  return from
}

const BOT_NAMES = ['Bot Cloud', 'Bot Rain', 'Bot Thunder', 'Bot Rainbow', 'Bot Wind']

/** A name for a new bot that nobody at the table has yet. */
export function botName(players: { name: string }[]): string {
  const used = new Set(players.map((player) => player.name))
  const free = BOT_NAMES.find((name) => !used.has(name))

  return free ?? `Bot ${players.length + 1}`
}
