import { json } from '@sveltejs/kit'
import { failure } from '#lib/server/platform/client.ts'
import { readName, startGuest } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

/** "Play as guest": a new guest for this browser, under the name it picked. */
export const POST: RequestHandler = async (event) => {
  const name = await readName(event.request)

  try {
    const player = await startGuest(event, name)
    return json({ player }, { status: 201 })
  } catch (err) {
    return failure(err)
  }
}
