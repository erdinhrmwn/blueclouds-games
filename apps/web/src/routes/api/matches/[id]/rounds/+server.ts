import { json } from '@sveltejs/kit'
import { failure } from '#lib/server/platform/client.ts'
import { matchRounds } from '#lib/server/platform/history.ts'
import type { RequestHandler } from './$types'

/** A match's rounds for the Fair play dialog, read while the match is played. */
export const GET: RequestHandler = async (event) => {
  try {
    const rounds = await matchRounds(event, event.params.id)
    return json(rounds)
  } catch (err) {
    return failure(err)
  }
}
