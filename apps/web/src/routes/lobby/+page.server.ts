import { pausedGames } from '#lib/server/platform.ts'
import type { PageServerLoad } from './$types'

/** The games paused for maintenance: the lobby opens no new tables for them. */
export const load: PageServerLoad = async (event) => {
  return { paused: await pausedGames(event) }
}
