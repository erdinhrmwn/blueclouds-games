<script lang="ts">
  import { stage } from '#lib/stage.svelte.ts'
  import type { Card } from 'contracts/rooms/cloudburst'
  import CloudCard from './CloudCard.svelte'

  /** Your hand as one row of cards to play, or to pick the card a Gust gives away. */
  interface Props {
    /** Sorted for showing. */
    hand: Card[]
    myTurn: boolean
    canMove: boolean
    /** While dealing, only the first `dealtCount` cards have landed. */
    dealing: boolean
    dealtCount: number
    /** The card flying to the pile, hidden here. */
    placingId: string | null
    /** The Gust or Rainbow waiting for its second pick. */
    pendingId: string | null
    /** A Gust waits for the card to give. */
    giving: boolean
    /** The card just drawn, the only one playable now. */
    drawnId: string | null
    playable: (card: Card) => boolean
    onchoose: (card: Card) => void
  }

  let {
    hand,
    myTurn,
    canMove,
    dealing,
    dealtCount,
    placingId,
    pendingId,
    giving,
    drawnId,
    playable,
    onchoose,
  }: Props = $props()

  /**
   * The hand fans out to fit its row: each card shows as much as fits, up to the full overlap look, but never less
   * than 44px to tap. A hand too long for that scrolls sideways. Card widths match CloudCard's `lg`.
   */
  const HAND = {
    tall: { cardPx: 64, mostShownPx: 44, paddingPx: 16 },
    wide: { cardPx: 88, mostShownPx: 60, paddingPx: 32 },
    leastShownPx: 44,
  }
  let handWidth = $state(0)
  const handOverlap = $derived.by(() => {
    const size = stage.wide ? HAND.wide : HAND.tall
    const space = handWidth - size.paddingPx - size.cardPx
    const fits = hand.length > 1 ? Math.floor(space / (hand.length - 1)) : size.mostShownPx
    const shown = Math.max(HAND.leastShownPx, Math.min(size.mostShownPx, fits))

    return size.cardPx - shown
  })

  // Left and right arrows move along the hand.
  function arrows(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ]
    const current = cards.findIndex((card) => card === document.activeElement)
    const step = event.key === 'ArrowRight' ? 1 : -1

    cards[(current + step + cards.length) % cards.length]?.focus()
    event.preventDefault()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- On the tall stage the row runs edge to edge, past the stage's gutter, so a full hand of seven fits. -->
<div
  class="hand -mx-4 flex w-[calc(100%+2rem)] justify-center-safe overflow-x-auto px-2 pt-4 pb-2 wide:mx-0 wide:w-full wide:px-4 wide:pt-5"
  class:pointer-events-none={dealing}
  bind:clientWidth={handWidth}
  onkeydown={arrows}
>
  {#each hand as card, index (card.id)}
    {@const isPending = pendingId === card.id}
    {@const landed = !dealing || index < dealtCount}
    <div
      class="shrink-0 {dealing && landed ? 'dealt-in' : ''}"
      class:invisible={placingId === card.id || !landed}
      style={index ? `margin-left: -${handOverlap}px` : ''}
      data-card={card.id}
    >
      <CloudCard
        {card}
        size="lg"
        fits={myTurn && (giving ? !isPending : playable(card))}
        selected={isPending || card.id === drawnId}
        disabled={!canMove || (giving ? isPending : !playable(card))}
        label={giving ? 'Give' : 'Play'}
        onplay={() => onchoose(card)}
      />
    </div>
  {/each}
</div>

<style>
  .hand {
    scrollbar-width: thin;
  }
</style>
