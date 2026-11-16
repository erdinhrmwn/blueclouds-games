<script lang="ts">
  import { GAMES, gameBySlug } from '#lib/games/catalog.ts'
  import { when } from '#lib/when.ts'
  import type { PageProps } from './$types'

  /** The player's finished matches, newest first. Each opens its rounds and a check of every shuffle. */
  let { data }: PageProps = $props()

  // Dates are written in the viewer's own zone, so only once the page runs in the browser.
  let mounted = $state(false)
  $effect(() => {
    mounted = true
  })

  /** 1st, 2nd, 3rd, 4th… 11th, 12th, 13th. */
  const ordinal = (place: number) => {
    const lastTwo = place % 100
    if (lastTwo >= 11 && lastTwo <= 13) {
      return `${place}th`
    }

    const suffix = ['th', 'st', 'nd', 'rd'].at(place % 10) ?? 'th'

    return `${place}${suffix}`
  }

  /** The filter chips: every game, then each game in the catalog. */
  const filters = $derived([
    { slug: null, name: 'All games' },
    ...GAMES.map((game) => ({ slug: game.slug, name: game.name })),
  ])

  const filterHref = (slug: string | null) => (slug ? `?game=${slug}` : '/history')

  const olderHref = $derived(
    data.game ? `?game=${data.game}&cursor=${data.nextCursor}` : `?cursor=${data.nextCursor}`,
  )
</script>

<svelte:head><title>History · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-2xl pt-10 md:pt-16">
  <h1 class="font-display text-4xl leading-tight font-black">Match history</h1>
  <p class="mt-2 text-sm text-paper/75">Your finished matches. Open one to check every round.</p>

  <nav class="mt-6 flex flex-wrap gap-2" aria-label="Filter by game">
    {#each filters as filter (filter.slug ?? 'all')}
      {@const current = filter.slug === data.game}
      <a
        href={filterHref(filter.slug)}
        aria-current={current ? 'page' : undefined}
        class="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brass {current
          ? 'border-brass bg-brass text-ink'
          : 'border-paper/20 text-paper/80 hover:border-paper/45'}">{filter.name}</a
      >
    {/each}
  </nav>

  {#if data.matches.length === 0}
    <p class="mt-6 rounded-xl border border-paper/15 bg-panel p-6 text-sm text-paper/75">
      {data.game
        ? `No finished ${gameBySlug(data.game)?.name} matches yet.`
        : 'No finished matches yet.'}
    </p>
  {:else}
    <ul class="mt-6 divide-y divide-paper/10 rounded-xl border border-paper/15 bg-panel">
      {#each data.matches as match (match.id)}
        <li>
          <a
            href="/history/{match.id}"
            class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
          >
            <span class="min-w-0 flex-1">
              <span class="block font-semibold text-paper">
                {gameBySlug(match.game)?.name ?? match.game}
              </span>
              <time class="block text-xs text-paper/55" datetime={match.endedAt}>
                {mounted ? when(match.endedAt) : ''}
              </time>
            </span>
            <span class="text-sm text-paper/75">
              {#if match.endReason === 'terminated'}
                Stopped by an admin
              {:else}
                {ordinal(match.placement)} of {match.players}
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.nextCursor}
    <p class="mt-4 text-center">
      <a class="btn-ghost px-4" href={olderHref}>Older matches</a>
    </p>
  {/if}
</section>
