// Tournaments: a game's tournaments, signing up and out, standings, and a tournament's own page.

import type { RequestEvent } from '@sveltejs/kit'
import { type Data, platform, platformClient, segment } from './client.ts'
import { lost, secretOf, secretOrNameFirst, signedIn } from './session.ts'

type Tournaments = Data<typeof platform.tournaments.$get>

export type Tournament = Tournaments['tournaments'][number]

export type TournamentFormat = NonNullable<Tournament['format']>

export type TournamentPrize = Tournament['prizes'][number]

/** A tournament that is playing, or finished within the last day, as the lobby shows it. */
export type LiveTournament = Tournaments['live'][number]

/** One row of a tournament's standings; the final places once it finished. */
export type Standing = Data<
  (typeof platform.tournaments)[':id']['standings']['$get']
>['standings'][number]

export type TournamentTable = Data<typeof platform.players.me.rooms.$get>['rooms'][number]

/** A game's tournaments for its lobby, and the player's tables in them. */
export interface GameTournaments {
  tournaments: Tournament[]
  live: LiveTournament[]
  tables: TournamentTable[]
}

/** A game's tournaments open for sign-up, and the tournament tables this player sits at. Empty before they chose a name. */
export async function tournamentsFor(event: RequestEvent, game: string): Promise<GameTournaments> {
  const secret = secretOf(event.cookies)
  const none: GameTournaments = { tournaments: [], live: [], tables: [] }
  if (!secret) {
    return none
  }

  const query = { game }

  try {
    const [{ tournaments, live }, { rooms }] = await Promise.all([
      platformClient.call(event, secret, (options) =>
        platform.tournaments.$get({ query }, options),
      ),
      platformClient.call(event, secret, (options) =>
        platform.players.me.rooms.$get({ query }, options),
      ),
    ])

    return { tournaments, live, tables: rooms }
  } catch (err) {
    if (lost(err)) {
      return none
    }

    throw err
  }
}

/** Signs the player up for a tournament. */
export async function joinTournament(event: RequestEvent, id: string): Promise<void> {
  const secret = secretOrNameFirst(event.cookies)

  await platformClient.call(event, secret, (options) =>
    platform.tournaments[':id'].registration.$post({ param: { id: segment(id) } }, options),
  )
}

/** A tournament's standings: worked out from the matches so far, or its final places once it finished. */
export async function tournamentStandings(event: RequestEvent, id: string): Promise<Standing[]> {
  const secret = secretOrNameFirst(event.cookies)
  const { standings } = await platformClient.call(event, secret, (options) =>
    platform.tournaments[':id'].standings.$get({ param: { id: segment(id) } }, options),
  )

  return standings
}

/** Signs the player out of a tournament, while sign-up is open. */
export async function leaveTournament(event: RequestEvent, id: string): Promise<void> {
  const secret = secretOrNameFirst(event.cookies)

  await platformClient.call(event, secret, (options) =>
    platform.tournaments[':id'].registration.$delete({ param: { id: segment(id) } }, options),
  )
}

/** The tournament tables the player sits at right now, in any game. */
export async function mySeats(event: RequestEvent): Promise<TournamentTable[]> {
  const { rooms } = await platformClient.call(event, signedIn(event), (options) =>
    platform.players.me.rooms.$get({ query: {} }, options),
  )

  return rooms
}

/** A tournament's own page: what it is, every round's tables (the bracket), and the standings. */
export type TournamentBoard = Data<(typeof platform.tournaments)[':id']['$get']>

/** One table of a tournament round, its players best finish first; an unplayed seat has no placement. */
export type BoardTable = TournamentBoard['rounds'][number]['tables'][number]

export async function tournamentBoard(event: RequestEvent, id: string): Promise<TournamentBoard> {
  return platformClient.call(event, signedIn(event), (options) =>
    platform.tournaments[':id'].$get({ param: { id: segment(id) } }, options),
  )
}
