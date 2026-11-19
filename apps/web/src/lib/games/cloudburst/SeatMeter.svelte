<script lang="ts">
  import { unscaled } from '#lib/stage.svelte.ts'
  import type { Player } from 'contracts/rooms/cloudburst'
  import CloudCard from './CloudCard.svelte'
  import { REVEAL, type Reveal } from './reveal.svelte.ts'

  /**
   * A seat's cloud meter: one segment per point up to the burst limit. At a round end the seat's leftover hand
   * fans open above it and each card drips into the next segment.
   */
  interface Props {
    player: Player
    burstAt: number
    reveal: Reveal
  }

  let { player, burstAt, reveal }: Props = $props()

  const shown = $derived(reveal.pointsOf(player))
  const left = $derived(reveal.leftOf(player.id))

  /** A segment: filled, filled and close to bursting, or empty. */
  const segmentClass = (index: number) => {
    if (index >= shown) {
      return 'bg-paper/20'
    }

    return shown >= burstAt - 2 ? 'bg-ember' : 'bg-paper/85'
  }

  /** Width of an `xs` card, and of the whole fan so it stays inside a seat on the tall stage. */
  const FAN = { cardPx: 28, maxPx: 88, stepPx: 14 }
  const overlap = (count: number) => {
    const step = Math.min(FAN.stepPx, (FAN.maxPx - FAN.cardPx) / Math.max(1, count - 1))
    return FAN.cardPx - step
  }

  /** One revealed card: fans out from the seat, waits, then falls into its meter segment. */
  function drip(node: HTMLElement, { i, n, from }: { i: number; n: number; from: number }) {
    const meter = node.closest('[data-meter]')
    const segmentIndex = Math.min(from + i, burstAt - 1)
    const segment = meter?.querySelector(`[data-seg="${segmentIndex}"]`) ?? meter
    if (!segment) {
      return
    }

    const start = node.getBoundingClientRect()
    const end = segment.getBoundingClientRect()
    // Measured on screen, moved inside the scaled stage.
    const dx = unscaled(end.left + end.width / 2 - (start.left + start.width / 2))
    const dy = unscaled(end.top + end.height / 2 - (start.top + start.height / 2))

    const fallAt = REVEAL.holdMs + i * Math.min(REVEAL.stepMs, REVEAL.spreadMs / n)
    const total = fallAt + REVEAL.fallMs
    const spread = (i - (n - 1) / 2) * 6

    const frames = [
      {
        offset: 0,
        transform: `translateX(${-spread}px) scale(0.6)`,
        opacity: 0,
        easing: 'ease-out',
      },
      { offset: REVEAL.fanMs / total, transform: 'none', opacity: 1 },
      {
        offset: fallAt / total,
        transform: 'none',
        opacity: 1,
        easing: 'cubic-bezier(0.55, 0, 0.9, 0.45)',
      },
      { offset: 1, transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0 },
    ]

    const anim = node.animate(frames, { duration: total, fill: 'both' })
    anim.onfinish = () => reveal.land(player, burstAt)

    return { destroy: () => anim.cancel() }
  }
</script>

<span
  class="relative flex items-center gap-px"
  class:burst={reveal.bursting.includes(player.id)}
  data-meter
  role="img"
  aria-label="{player.points} of {burstAt} points"
>
  {#each Array(burstAt) as _, i (i)}
    <span data-seg={i} class="h-1.5 w-1 rounded-[1px] wide:h-2 wide:w-[5px] {segmentClass(i)}"
    ></span>
  {/each}
  <span class="ml-1 text-[10px] text-paper/75 tabular-nums wide:text-[11px]">{shown}</span>
  {#if left.length}
    <!-- The hand left at the end of the round, face up; each card drips into the meter. -->
    <span
      class="pointer-events-none absolute bottom-full left-1/2 mb-14 flex -translate-x-1/2 wide:mb-16"
      aria-hidden="true"
    >
      {#each left as card, i (i)}
        <span
          class="shrink-0"
          style={i ? `margin-left: -${overlap(left.length)}px` : ''}
          use:drip={{ i, n: left.length, from: player.points - left.length }}
        >
          <CloudCard {card} size="xs" />
        </span>
      {/each}
    </span>
  {/if}
</span>

<style>
  /* The meter that reached the limit flashes ember twice. */
  .burst {
    animation: flash 450ms ease-in-out 2;
  }
  @keyframes flash {
    50% {
      filter: brightness(1.5) drop-shadow(0 0 3px var(--color-ember));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .burst {
      animation: none;
    }
  }
</style>
