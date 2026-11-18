import { error } from '@sveltejs/kit'
import { gameBySlug } from '#lib/games/catalog.ts'
import { PlatformError } from '#lib/server/platform/client.ts'
import { myMatches } from '#lib/server/platform/history.ts'
import type { PageServerLoad } from './$types'

/** The player's finished matches, newest first; `?game=` keeps one game, `?cursor=` pages back. */
export const load: PageServerLoad = async (event) => {
  const cursor = event.url.searchParams.get('cursor')
  // A game we don't know shows every game rather than an empty list.
  const asked = event.url.searchParams.get('game')
  const game = asked && gameBySlug(asked) ? asked : null

  try {
    const page = await myMatches(event, cursor, game)

    return { ...page, game }
  } catch (err) {
    if (err instanceof PlatformError) {
      error(err.status, err.message)
    }

    throw err
  }
}
