import { error, json } from '@sveltejs/kit'
import { AVATAR_COLORS, AVATAR_ICONS } from 'contracts/avatars'
import { z } from 'zod'
import { readJson } from '#lib/server/body.ts'
import { failure } from '#lib/server/platform/client.ts'
import { savePlayerAvatar } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

/** A colour (or null for the default) and an icon (or null for the initial); a missing one means null. */
const Pick = z.object({
  color: z.enum(AVATAR_COLORS).nullable().default(null),
  icon: z.enum(AVATAR_ICONS).nullable().default(null),
})

/** Picks a preset avatar. */
export const PUT: RequestHandler = async (event) => {
  const avatar = await readJson(event.request, Pick)
  if (!avatar) {
    error(400, 'Pick one of the preset colours and icons.')
  }

  try {
    return json({ avatar: await savePlayerAvatar(event, avatar) })
  } catch (err) {
    return failure(err)
  }
}
