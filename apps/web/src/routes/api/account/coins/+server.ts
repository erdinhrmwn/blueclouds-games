import { json } from '@sveltejs/kit'
import { failure } from '#lib/server/platform/client.ts'
import { coinsOf } from '#lib/server/platform/history.ts'
import type { RequestHandler } from './$types'

/** The player's coin balance and what changed it; `?before=` pages back (the platform checks the id). */
export const GET: RequestHandler = async (event) => {
  const before = event.url.searchParams.get('before')

  try {
    const coins = await coinsOf(event, before)
    return json(coins, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return failure(err)
  }
}
