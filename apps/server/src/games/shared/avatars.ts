/**
 * Preset avatars (FigCraft page "Brand · Avatars"): a colour and, optionally, an icon in place of the initial.
 * The platform keeps the same lists (players.avatar_color / avatar_icon checks and its request schema).
 */
export const AVATAR_COLORS = [
  'rain',
  'navy',
  'wind',
  'felt',
  'teal',
  'slate',
  'storm',
  'rose',
  'oxblood',
  'ember',
  'sun',
  'brass',
] as const

export const AVATAR_ICONS = [
  'cloud',
  'sun',
  'moon',
  'star',
  'bolt',
  'drop',
  'snow',
  'rainbow',
  'leaf',
  'flame',
  'kite',
  'crown',
  'chip',
  'die',
  'gem',
  'anchor',
] as const

export type AvatarColor = (typeof AVATAR_COLORS)[number]
export type AvatarIcon = (typeof AVATAR_ICONS)[number]

/** Null fields are not picked yet: the colour then comes from the player id and the initial stands in for the icon. */
export type Avatar = { color: AvatarColor | null; icon: AvatarIcon | null }

export const NO_AVATAR: Avatar = { color: null, icon: null }

/** The colour a player shows before picking one: steady for the same id, spread over the palette. */
export function defaultAvatarColor(id: string): AvatarColor {
  let sum = 0
  for (const letter of id) {
    sum += letter.codePointAt(0) ?? 0
  }

  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!
}
