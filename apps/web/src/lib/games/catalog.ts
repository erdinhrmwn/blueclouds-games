import * as bust31 from 'contracts/rooms/bust-31'
import * as cloudburst from 'contracts/rooms/cloudburst'
import type { Component } from 'svelte'
import Bust31Emblem from './bust-31/Emblem.svelte'
import Bust31Fan from './bust-31/Fan.svelte'
import Bust31Home from './bust-31/Home.svelte'
import Bust31Room from './bust-31/Room.svelte'
import CloudburstEmblem from './cloudburst/Emblem.svelte'
import CloudburstFan from './cloudburst/Fan.svelte'
import CloudburstHome from './cloudburst/Home.svelte'
import CloudburstRoom from './cloudburst/Room.svelte'

export interface GameEntry {
  slug: string
  name: string
  tagline: string
  /** The rule in a few words, for the game's own page. */
  rule: string
  /** One more fact for the game's own page, after the player count. */
  fact: string
  /** What kind of card game, as in "a shedding card game". */
  kind: string
  minPlayers: number
  maxPlayers: number
  /** The utility that gives an element this game's card back (see layout.css). */
  back: string
  /** The profile's line about rounds: what a round won means in this game ("Survived 3 of 4 rounds"). */
  roundsLine: (won: number, played: number) => string
  /** The game's logo: its card back cut into a tile with one motif. `small` under 48px. */
  Emblem: Component<{ small?: boolean; label?: string; class?: string }>
  /** A few sample cards: the game's picture. */
  Fan: Component<{ size?: 'sm' | 'md' }>
  /** The game's own page: rules plus the create/join forms. `maintenance`: no new tables for now. */
  Home: Component<{ game: GameEntry; maintenance: boolean }>
  /** Everything inside a room: lobby, table, connection. */
  Room: Component<{ game: GameEntry; code: string }>
}

// ponytail: every game's components load up front. Fine for a handful of games;
// switch Home/Room to `() => import(...)` once the bundle gets heavy.
export const GAMES: GameEntry[] = [
  {
    slug: 'bust-31',
    name: 'Bust 31',
    tagline: 'Play a card, add to the total, and don’t be the one who goes over 31.',
    rule: `Add to the total. Don’t go over ${bust31.LIMIT}.`,
    fact: `${bust31.START_LIVES} lives each`,
    kind: 'turn-based',
    minPlayers: bust31.MIN_PLAYERS,
    maxPlayers: bust31.MAX_PLAYERS,
    back: 'table-back-bust-31',
    roundsLine: (won, played) =>
      `Survived ${won} of ${played} ${played === 1 ? 'round' : 'rounds'}`,
    Emblem: Bust31Emblem,
    Fan: Bust31Fan,
    Home: Bust31Home,
    Room: Bust31Room,
  },
  {
    slug: 'cloudburst',
    name: 'Cloudburst',
    tagline: 'Match the weather, shed your hand first, and keep your cloud from bursting.',
    rule: 'Match the weather and shed your hand first.',
    fact: `bursts at ${cloudburst.BURST_AT} points`,
    kind: 'shedding',
    minPlayers: cloudburst.MIN_PLAYERS,
    maxPlayers: cloudburst.MAX_PLAYERS,
    back: 'table-back-cloudburst',
    roundsLine: (won, played) =>
      `Went out first in ${won} of ${played} ${played === 1 ? 'round' : 'rounds'}`,
    Emblem: CloudburstEmblem,
    Fan: CloudburstFan,
    Home: CloudburstHome,
    Room: CloudburstRoom,
  },
]

export const gameBySlug = (slug: string) => GAMES.find((game) => game.slug === slug)

/** How many of the items each game has, for the lobby's game filter. */
export function countByGame(items: { game: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    counts[item.game] = (counts[item.game] ?? 0) + 1
  }

  return counts
}
