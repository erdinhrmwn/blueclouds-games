<script lang="ts">
  import Icon from '#lib/components/Icon.svelte'
  import type { GameEntry } from '#lib/games/catalog.ts'
  import { fetchTournaments } from '#lib/platform.ts'
  import { player } from '#lib/player.svelte.ts'
  import { RoomList } from '#lib/rooms.svelte.ts'
  import { onMount, type Snippet } from 'svelte'
  import OpenTableDialog from './OpenTableDialog.svelte'
  import TableCodeJoin from './TableCodeJoin.svelte'

  /**
   * A game's own page, the same for every game: the game, open or join a table, a card into the lobby (where its
   * tables and tournaments are listed), then how to play.
   */
  interface Props {
    game: GameEntry
    maintenance: boolean
    rules: Snippet
  }

  let { game, maintenance, rules }: Props = $props()

  let opening = $state(false)
  let tables = $state<RoomList | null>(null)
  let tournamentCount = $state<number | null>(null)

  const tableCount = $derived(tables?.status === 'ready' ? tables.rooms.length : null)

  onMount(() => {
    const list = new RoomList([game.slug])
    tables = list
    return () => list.dispose()
  })

  /** Tournaments still to play or being played; the finished ones only show in the lobby. */
  async function countTournaments() {
    try {
      const { tournaments, live } = await fetchTournaments(game.slug)
      const running = live.filter((tournament) => !tournament.endedAt)
      tournamentCount = tournaments.length + running.length
    } catch {
      // The count is extra: without it the card still leads to the lobby.
      tournamentCount = null
    }
  }

  // Tournaments need a player to ask with: a brand-new visitor has none until they pick a name.
  $effect(() => {
    if (player.ready && player.name) {
      void countTournaments()
    }
  })
</script>

<nav class="pt-2 text-[13px] text-paper/55" aria-label="Breadcrumb">
  <a class="hover:text-paper" href="/">Games</a>
  <span aria-hidden="true">/</span>
  <span class="font-medium text-paper/85" aria-current="page">{game.name}</span>
</nav>

<header class="mt-3 grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
  <div class="flex items-start gap-5">
    <game.Emblem class="mt-1 size-16 shrink-0 sm:size-20" />
    <div>
      <h1 class="font-display text-4xl leading-tight font-black sm:text-[2.5rem]">{game.name}</h1>
      <p class="mt-0.5 text-[15px] font-medium text-paper/80">{game.rule}</p>
      <p class="mt-1 text-[13px] font-medium text-paper/50">
        {game.kind.charAt(0).toUpperCase()}{game.kind.slice(1)} · {game.minPlayers}–{game.maxPlayers}
        players · {game.fact}
      </p>
    </div>
  </div>
  <div class="flex flex-col gap-3 md:w-[27.625rem] md:flex-row">
    <button
      class="btn-brass h-12 shrink-0 rounded-xl px-6 text-[15px] md:w-45"
      onclick={() => (opening = true)}>Open a table</button
    >
    <div class="min-w-0 flex-1"><TableCodeJoin game={game.slug} /></div>
  </div>
</header>

<OpenTableDialog bind:open={opening} game={game.slug} paused={{ [game.slug]: maintenance }} />

<!-- The game's tables and tournaments are listed in the lobby; this card takes you there with the game picked. -->
<section
  class="mt-8 flex flex-col gap-4 rounded-2xl border border-paper/10 bg-panel p-5 sm:flex-row sm:items-center sm:justify-between"
  aria-labelledby="find-title"
>
  <div>
    <h2 id="find-title" class="font-display text-lg font-bold">Find a {game.name} game</h2>
    <p class="mt-1 text-[13px] text-paper/60">
      {#if tableCount === null || tournamentCount === null}
        Its open tables and tournaments are in the lobby.
      {:else}
        <span class="font-semibold text-paper/85">{tableCount}</span>
        open {tableCount === 1 ? 'table' : 'tables'} ·
        <span class="font-semibold text-paper/85">{tournamentCount}</span>
        {tournamentCount === 1 ? 'tournament' : 'tournaments'} in the lobby
      {/if}
    </p>
  </div>
  <a class="btn-ghost h-11 shrink-0 rounded-xl px-5" href="/lobby?game={game.slug}">
    See them in the lobby
    <Icon name="next" class="size-4" />
  </a>
</section>

<section id="how-to-play" class="mt-14 max-w-2xl scroll-mt-6" aria-label="How to play">
  {@render rules()}
</section>
