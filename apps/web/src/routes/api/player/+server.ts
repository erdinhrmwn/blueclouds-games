import { json } from '@sveltejs/kit'
import { failure } from '#lib/server/platform/client.ts'
import { readName, savePlayerName } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

/** Renames an account (guests keep their generated name). */
export const POST: RequestHandler = async (event) => {
  const name = await readName(event.request)

  try {
    await savePlayerName(event, name)
    return json({ name })
  } catch (err) {
    return failure(err)
  }
}
