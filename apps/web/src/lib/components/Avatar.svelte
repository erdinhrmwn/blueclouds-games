<script lang="ts" module>
  import type { Avatar, AvatarColor } from 'contracts/avatars'

  /** The 12 preset colours (FigCraft page "Brand · Avatars"): deep tones, so the paper icon always reads. */
  export const AVATAR_TONES: Record<AvatarColor, string> = {
    rain: '#2c5f8a',
    navy: '#1f3f5f',
    wind: '#2f6e4f',
    felt: '#1d4a3a',
    teal: '#1f5c5c',
    slate: '#3d4a57',
    storm: '#6a3d78',
    rose: '#8a3d5c',
    oxblood: '#5e1a1f',
    ember: '#a8452a',
    sun: '#8c5400',
    brass: '#7a5f28',
  }
</script>

<script lang="ts">
  import { defaultAvatarColor } from 'contracts/avatars'
  import AvatarGlyph from './AvatarGlyph.svelte'

  /**
   * A player's preset avatar: their colour with their icon, or their initial when they picked none. Sizing,
   * corners, border and the initial's font size come from `class`, so a seat, a pill and the profile share it.
   * Decorative: the name is always printed or labelled next to it.
   */
  interface Props {
    id: string
    name: string
    avatar: Avatar | null | undefined
    class?: string
  }

  let { id, name, avatar, class: cls = 'size-8 rounded-lg text-sm' }: Props = $props()

  const tone = $derived(AVATAR_TONES[avatar?.color ?? defaultAvatarColor(id)])
  const initial = $derived(name.trim().charAt(0).toUpperCase())
</script>

<span
  class="grid shrink-0 place-items-center font-display font-bold text-paper {cls}"
  style:background-color={tone}
  style:--avatar-tile={tone}
  aria-hidden="true"
>
  {#if avatar?.icon}
    <svg viewBox="0 0 24 24" class="size-[62%]">
      <AvatarGlyph icon={avatar.icon} />
    </svg>
  {:else}
    {initial}
  {/if}
</span>
