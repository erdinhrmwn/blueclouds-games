// What a player did: their matches, stats per game, a match's rounds, coins and tournaments.

import type { RequestEvent } from '@sveltejs/kit'
import { type Data, platform, platformClient, segment } from './client.ts'
import { signedIn } from './session.ts'

type MatchPage = Data<typeof platform.players.me.matches.$get>

/** One of the player's finished matches, as their history lists it. */
export type MatchSummary = MatchPage['matches'][number]

/** The player's finished matches, newest first, a page at a time; `game` keeps one game. */
export async function myMatches(
  event: RequestEvent,
  cursor: string | null,
  game: string | null = null,
): Promise<MatchPage> {
  const query = { cursor: cursor ?? undefined, game: game ?? undefined }

  return platformClient.call(event, signedIn(event), (options) =>
    platform.players.me.matches.$get({ query }, options),
  )
}

type MyStats = Data<typeof platform.players.me.stats.$get>

/**
 * The player's record in one game: finished matches played and won, wins in a row (best and still going), their
 * average place, and their rounds. What a round won means is the game's (see the catalog's `roundsWon`); `won` is
 * null for a game the platform can't count rounds for.
 */
export type GameStats = MyStats['games'][number]

/** The signed-in player's record per game, for their profile. */
export async function myStats(event: RequestEvent): Promise<MyStats> {
  return platformClient.call(event, signedIn(event), (options) =>
    platform.players.me.stats.$get({}, options),
  )
}

/** A match's rounds, running or finished. Matches are public: any player may look. */
export type MatchRounds = Data<(typeof platform.matches)[':id']['rounds']['$get']>

export async function matchRounds(event: RequestEvent, matchId: string): Promise<MatchRounds> {
  return platformClient.call(event, signedIn(event), (options) =>
    platform.matches[':id'].rounds.$get({ param: { id: segment(matchId) } }, options),
  )
}

type Coins = Data<typeof platform.players.me.coins.$get>

/** What changed a player's coins: a fee, refund, prize, bonus or an admin's change with its note. */
export type CoinChange = Coins['history'][number]

/** The player's coins and their history, newest first, a page at a time: `before` is the last change shown. */
export async function coinsOf(event: RequestEvent, before: string | null = null): Promise<Coins> {
  return platformClient.call(event, signedIn(event), (options) =>
    platform.players.me.coins.$get({ query: { before: before ?? undefined } }, options),
  )
}

type MyTournaments = Data<typeof platform.players.me.tournaments.$get>

/** One tournament the player is or was in, as their profile lists it. */
export type MyTournament = MyTournaments['tournaments'][number]

export type TournamentRecord = MyTournaments['record']

/** The tournaments the player is or was in, newest first, with their record over all of them. */
export async function myTournaments(event: RequestEvent): Promise<MyTournaments> {
  return platformClient.call(event, signedIn(event), (options) =>
    platform.players.me.tournaments.$get({}, options),
  )
}
