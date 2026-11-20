<script lang="ts">
  import Deck from '#lib/components/Deck.svelte'
  import { placeCard } from '#lib/motion.ts'
  import type { Card, Suit } from 'contracts/rooms/cloudburst'
  import CloudCard from './CloudCard.svelte'
  import WeatherVane from './WeatherVane.svelte'

  /**
   * The weather ring with the pile in it is the hero: on the wide stage between the deck and what to follow, on the
   * tall one over them. A new top card flies in from `flightFrom`.
   */
  interface Props {
    deckCount: number
    suit: Suit
    topCard: Card | null
    pileUnder: Card[]
    flightFrom: (cardId: string) => DOMRect | null
  }

  let { deckCount, suit, topCard, pileUnder, flightFrom }: Props = $props()

  /** A steady tilt of -6..6 degrees per card, from a hash of its id. */
  const tiltOf = (id: string) => {
    const hash = [...id].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0), 7)
    return (hash % 13) - 6
  }
</script>

<div
  class="grid grid-cols-2 items-center justify-items-center gap-x-6 gap-y-5 wide:flex wide:gap-10 [&>*:nth-child(2)]:col-span-2 [&>*:nth-child(2)]:row-start-1"
>
  <Deck count={deckCount} />
  <WeatherVane {suit} top={topCard}>
    <div class="grid h-[3.55rem] w-10 place-items-center wide:h-[4.6rem] wide:w-[3.25rem]">
      {#each pileUnder as card (card.id)}
        <div
          class="col-start-1 row-start-1"
          style="rotate: {tiltOf(card.id)}deg"
          aria-hidden="true"
        >
          <CloudCard {card} size="pile" />
        </div>
      {/each}
      {#key topCard?.id}
        {#if topCard}
          <div
            class="col-start-1 row-start-1"
            in:placeCard|global={{ from: flightFrom(topCard.id), tilt: -20 }}
          >
            <div style="rotate: {tiltOf(topCard.id)}deg">
              <CloudCard card={topCard} size="pile" />
            </div>
          </div>
        {/if}
      {/key}
    </div>
  </WeatherVane>
</div>
