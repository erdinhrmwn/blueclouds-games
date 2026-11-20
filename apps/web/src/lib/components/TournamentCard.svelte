<script lang="ts">
  import { gameBySlug } from '#lib/games/catalog.ts'
  import type { TournamentFormat } from '#lib/platform.ts'
  import { FORMATS } from '#lib/tournament-formats.ts'
  import type { Snippet } from 'svelte'
  import TournamentFelt from './TournamentFelt.svelte'

  /** What the felt on top of the card says. */
  interface Felt {
    label: string
    dot: string
    startsAt: string
    headline?: string
  }

  /**
   * One card of the lobby's tournament row: the game's felt on top, then the name, the game and format, a short
   * line about it (`meta`) and the card's own body.
   */
  interface Props {
    name: string
    /** The game's slug. */
    game: string
    format: TournamentFormat | null
    felt: Felt
    /** A brass border: the player is in it. */
    highlighted?: boolean
    meta: Snippet
    children: Snippet
  }

  let { name, game, format, felt, highlighted = false, meta, children }: Props = $props()

  const shown = $derived(gameBySlug(game))
</script>

<li class="tournament {highlighted ? 'border-[1.5px] border-brass' : 'border border-paper/10'}">
  <TournamentFelt {...felt} back={shown?.back ?? ''} />
  <div class="flex flex-1 flex-col p-4 pt-3">
    <h3 class="font-display text-lg font-bold text-paper">{name}</h3>
    <p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper/55">
      <span class="font-semibold text-paper/85">{shown?.name ?? game}</span>
      {#if format}
        <span class="rounded-md border border-brass/55 px-1.5 py-0.5 font-bold text-brass"
          >{FORMATS[format].label}</span
        >
      {/if}
      {@render meta()}
    </p>
    {@render children()}
  </div>
</li>

<style>
  .tournament {
    display: flex;
    width: 85%;
    flex-shrink: 0;
    scroll-snap-align: start;
    flex-direction: column;
    overflow: hidden;
    border-radius: 1rem;
    background: var(--color-panel);
  }
  @media (min-width: 40rem) {
    .tournament {
      width: 20rem;
    }
  }
  /* Three cards fill the row; the arrow brings in the rest. */
  @media (min-width: 64rem) {
    .tournament {
      width: calc((100% - 2rem) / 3);
    }
  }
</style>
