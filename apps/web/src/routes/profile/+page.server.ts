import {
  myMatches,
  mySeats,
  myStats,
  myTournaments,
  PlatformError,
  type TournamentRecord,
} from '#lib/server/platform.ts'
import type { PageServerLoad } from './$types'

/** How many finished matches the profile lists; the rest are on the history page. */
const RECENT_COUNT = 4

/** How many results the "Recent form" strip shows, newest first. */
const FORM_COUNT = 10

const NO_RECORD: TournamentRecord = { played: 0, podiums: 0, bestPlace: null, prizeCoins: 0 }

/**
 * The player's record per game, their latest matches and tournaments, and the tournament tables they sit at now.
 * All extras on the profile: when the platform can't answer (or there is no player yet), the page still shows
 * the name and account.
 */
export const load: PageServerLoad = async (event) => {
  try {
    const [record, history, tournaments, seats] = await Promise.all([
      myStats(event),
      myMatches(event, null),
      myTournaments(event),
      mySeats(event),
    ])

    return {
      stats: record.games,
      recent: history.matches.slice(0, RECENT_COUNT),
      form: history.matches.slice(0, FORM_COUNT),
      tournaments: tournaments.tournaments,
      tournamentRecord: tournaments.record,
      seats,
    }
  } catch (err) {
    if (!(err instanceof PlatformError)) {
      throw err
    }

    return {
      stats: [],
      recent: [],
      form: [],
      tournaments: [],
      tournamentRecord: NO_RECORD,
      seats: [],
    }
  }
}
