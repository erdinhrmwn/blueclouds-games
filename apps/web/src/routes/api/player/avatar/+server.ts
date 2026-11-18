import { error, json } from '@sveltejs/kit'
import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  type Avatar,
  type AvatarColor,
  type AvatarIcon,
} from 'contracts/avatars'
import { failure } from '#lib/server/platform/client.ts'
import { savePlayerAvatar } from '#lib/server/platform/session.ts'
import type { RequestHandler } from './$types'

const isColor = (value: unknown): value is AvatarColor =>
  AVATAR_COLORS.includes(value as AvatarColor)
const isIcon = (value: unknown): value is AvatarIcon => AVATAR_ICONS.includes(value as AvatarIcon)

/** Picks a preset avatar: a colour (or null for the default) and an icon (or null for the initial). */
export const PUT: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null
  const color = body?.color ?? null
  const icon = body?.icon ?? null
  const validColor = color === null || isColor(color)
  const validIcon = icon === null || isIcon(icon)
  if (!validColor || !validIcon) {
    error(400, 'Pick one of the preset colours and icons.')
  }

  try {
    const avatar = await savePlayerAvatar(event, { color, icon } as Avatar)
    return json({ avatar })
  } catch (err) {
    return failure(err)
  }
}
