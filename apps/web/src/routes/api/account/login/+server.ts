import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { readJson } from '#lib/server/body.ts'
import { failure } from '#lib/server/platform/client.ts'
import { login } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

// A missing field goes on as empty: the platform answers with one message per field.
const text = z.string().catch('')
const Fields = z.object({ username: text, password: text })

export const POST: RequestHandler = async (event) => {
  const fields = (await readJson(event.request, Fields)) ?? { username: '', password: '' }

  try {
    const player = await login(event, fields)
    return json({ player })
  } catch (err) {
    return failure(err)
  }
}
