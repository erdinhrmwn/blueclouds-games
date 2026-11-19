<script lang="ts">
  import type { Card } from 'contracts/rooms/cloudburst'
  import CloudCard from './CloudCard.svelte'

  /** A small fan of sample cards: the game's picture on its home page and the landing page. */
  interface Props {
    size?: 'sm' | 'md'
  }

  let { size = 'md' }: Props = $props()

  const SAMPLE: Card[] = [
    { id: 's1', kind: 'number', suit: 'rain', value: 4 },
    { id: 's2', kind: 'number', suit: 'rain', value: 5 },
    { id: 's3', kind: 'gust', suit: 'wind', value: 0 },
    { id: 's4', kind: 'rainbow', suit: null, value: 0 },
  ]
</script>

<div class="flex" aria-hidden="true">
  {#each SAMPLE as card, i (card.id)}
    <div
      class="-mr-3"
      style="transform: rotate({(i - 1.5) * 7}deg) translateY({i === 1 || i === 2 ? -6 : 0}px)"
    >
      <CloudCard {card} {size} />
    </div>
  {/each}
</div>
