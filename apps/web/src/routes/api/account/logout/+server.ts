import { json } from '@sveltejs/kit'
import { failure } from '#lib/server/platform/client.ts'
import { logout } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async (event) => {
  try {
    await logout(event)
    return json({ signedOut: true })
  } catch (err) {
    return failure(err)
  }
}
