import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { readJson } from '#lib/server/body.ts'
import { failure } from '#lib/server/platform/client.ts'
import { changePassword } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

// A missing field goes on as empty: the platform answers with one message per field.
const text = z.string().catch('')
const Fields = z.object({ currentPassword: text, newPassword: text })

/** Changes the signed-in account's password. Every other device is signed out; this one stays in. */
export const PUT: RequestHandler = async (event) => {
  const fields = (await readJson(event.request, Fields)) ?? { currentPassword: '', newPassword: '' }

  try {
    await changePassword(event, fields)
    return json({ changed: true })
  } catch (err) {
    return failure(err)
  }
}
