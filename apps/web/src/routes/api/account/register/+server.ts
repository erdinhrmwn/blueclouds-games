import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { readJson } from '#lib/server/body.ts'
import { failure } from '#lib/server/platform/client.ts'
import { register } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

// A missing field goes on as empty: the platform answers with one message per field.
const text = z.string().catch('')
const Fields = z.object({ name: text, username: text, password: text })

/** Creates an account; the platform checks the fields and answers with one message per field. */
export const POST: RequestHandler = async (event) => {
  const body = (await readJson(event.request, Fields)) ?? { name: '', username: '', password: '' }
  const fields = { ...body, name: body.name.trim() }

  try {
    const player = await register(event, fields)
    return json({ player })
  } catch (err) {
    return failure(err)
  }
}
