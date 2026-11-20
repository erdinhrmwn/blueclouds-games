<script lang="ts">
  import Icon from '#lib/components/Icon.svelte'
  import { ask } from '#lib/confirm.svelte.ts'
  import {
    fetchTournaments,
    joinTournament,
    leaveTournament,
    type LiveTournament,
    type Tournament,
  } from '#lib/platform.ts'
  import { player, refreshCoins } from '#lib/player.svelte.ts'
  import { enterTable } from '#lib/tables.ts'
  import { countByGame, gameBySlug } from '#lib/games/catalog.ts'
  import { coins } from '#lib/tournament-formats.ts'
  import {
    actionOf,
    FULL,
    openStatus,
    shortBy,
    SIGN_UP_OPEN,
    type OfGame,
    type Status,
  } from '#lib/tournament-status.ts'
  import { prefersReducedMotion } from 'svelte/motion'
  import FinishedTournamentCard from './FinishedTournamentCard.svelte'
  import OpenTournamentCard from './OpenTournamentCard.svelte'
  import RunningTournamentCard from './RunningTournamentCard.svelte'
  import TournamentDialog from './TournamentDialog.svelte'
  import TournamentLiveDialog from './TournamentLiveDialog.svelte'

  /**
   * The tournaments of every game in `games` as a row of cards that scrolls sideways: the ones playing (with the
   * player's place and table), the ones open for sign-up, then the ones that finished in the last day. `game` shows
   * only that game's; `counts` reports how many each game has, whatever is shown.
   */
  interface Props {
    games: string[]
    game?: string | null
    counts?: Record<string, number>
  }

  let { games, game = null, counts = $bindable({}) }: Props = $props()

  /** A game's own card back, shown on the felt at the top of its tournaments' cards. */
  const backOf = (slug: string) => gameBySlug(slug)?.back ?? ''
  const nameOf = (slug: string) => gameBySlug(slug)?.name ?? slug

  let live = $state<OfGame<LiveTournament>[]>([])
  let open = $state<OfGame<Tournament>[]>([])
  const picked = <T extends { game: string }>(list: T[]) =>
    game ? list.filter((tournament) => tournament.game === game) : list
  const shownLive = $derived(picked(live))
  const shownOpen = $derived(picked(open))
  const running = $derived(shownLive.filter((tournament) => !tournament.endedAt))
  const finished = $derived(shownLive.filter((tournament) => tournament.endedAt))
  const gameName = $derived(game ? nameOf(game) : '')
  /**
   * Any tournament of any game, shown or not, that can still change: one in sign-up (it closes, then gets its
   * tables) or one being played (its stage starts, then it finishes).
   */
  const changing = $derived(open.length > 0 || live.some((tournament) => !tournament.endedAt))

  /** The countdowns, and the sign-up status that turns at its closing time, tick while anything can change. */
  const TICK_MS = 15_000
  let now = $state(Date.now())

  $effect(() => {
    if (!changing) {
      return
    }

    const timer = setInterval(() => {
      now = Date.now()
    }, TICK_MS)

    return () => clearInterval(timer)
  })
  let busy = $state<string | null>(null)
  let error = $state<string | null>(null)

  let scroller = $state<HTMLUListElement>()
  let canGoBack = $state(false)
  let canGoForward = $state(false)

  /** Slack for rounding, so a row scrolled to its end doesn't still offer an arrow. */
  const EDGE_PX = 4
  /** One arrow press moves this share of the visible row, so the last card stays in view as a cue. */
  const PAGE_SHARE = 0.9

  function updateArrows() {
    if (!scroller) {
      return
    }

    const { scrollLeft, clientWidth, scrollWidth } = scroller
    canGoBack = scrollLeft > EDGE_PX
    canGoForward = scrollLeft + clientWidth < scrollWidth - EDGE_PX
  }

  function page(direction: 1 | -1) {
    if (!scroller) {
      return
    }

    const behavior = prefersReducedMotion.current ? 'auto' : 'smooth'
    scroller.scrollBy({ left: direction * scroller.clientWidth * PAGE_SHARE, behavior })
  }

  // The cards change when the lists reload or another game is picked; the arrows follow.
  $effect(() => {
    void shownLive.length
    void shownOpen.length
    updateArrows()
  })

  /** One game's tournaments, each marked with the game. */
  async function loadGame(slug: string) {
    const result = await fetchTournaments(slug)
    const tag = <T,>(tournament: T) => ({ ...tournament, game: slug })

    return { open: result.tournaments.map(tag), live: result.live.map(tag) }
  }

  async function load() {
    const results = await Promise.allSettled(games.map((slug) => loadGame(slug)))

    // Nothing answered (a network blip): keep the cards already shown until the next reload.
    if (results.every((result) => result.status === 'rejected')) {
      return
    }

    const nextOpen: OfGame<Tournament>[] = []
    const nextLive: OfGame<LiveTournament>[] = []

    for (const result of results) {
      // Tournaments are extra: a game that fails to answer is left out, the rest of the page works on.
      if (result.status === 'rejected') {
        continue
      }

      nextOpen.push(...result.value.open)
      nextLive.push(...result.value.live)
    }

    open = nextOpen
    live = nextLive
    now = Date.now()
    counts = countByGame([...nextLive, ...nextOpen])
  }

  /** The card's Join or Leave, for this player's coins and this tournament's request. */
  const actionFor = (tournament: Tournament, status: Status) =>
    actionOf(tournament, status, { saving: busy === tournament.id, coins: player.coins })

  /** The tournament whose Detail dialog is open. */
  let detailId = $state<string | null>(null)
  let detailOpen = $state(false)
  const detail = $derived(open.find((tournament) => tournament.id === detailId) ?? null)
  const detailStatus = $derived(detail ? openStatus(detail, now) : SIGN_UP_OPEN)

  function showDetail(tournament: Tournament) {
    detailId = tournament.id
    detailOpen = true
  }

  // Reload once the player has a name: a brand-new visitor has no account to sign up with yet.
  $effect(() => {
    if (player.ready && player.name) {
      void load()
    }
  })

  /**
   * The platform's job runs every minute: it closes sign-up, hands out tables and starts rounds. Reloading this often
   * shows a waiting player their table without a page refresh.
   */
  const RELOAD_MS = 30_000

  $effect(() => {
    if (!changing || !player.name) {
      return
    }

    const timer = setInterval(() => {
      void load()
    }, RELOAD_MS)

    return () => clearInterval(timer)
  })

  /** Gives up a seat already handed out. The platform keeps the player out of this tournament from then on. */
  async function withdraw(tournament: LiveTournament) {
    const { id, name } = tournament
    const sure = await ask({
      title: `Withdraw from ${name}?`,
      body: 'Your seat is given up and you can’t come back to this tournament.',
      action: 'Withdraw',
    })
    if (!sure) {
      return
    }

    busy = id
    error = null

    try {
      await leaveTournament(id)
      await load()
      void refreshCoins()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong. Try again.'
    } finally {
      busy = null
    }
  }

  /** Whose live Detail is open. */
  let liveId = $state<string | null>(null)
  let liveOpen = $state(false)
  const liveDetail = $derived(live.find((tournament) => tournament.id === liveId) ?? null)

  function showLive(tournament: LiveTournament) {
    liveId = tournament.id
    liveOpen = true
  }

  /** Joining with a fee asks first, showing what it costs and what is left. */
  async function confirmFee(tournament: Tournament): Promise<boolean> {
    if (tournament.joined || tournament.fee === 0) {
      return true
    }

    const left = player.coins - tournament.fee
    return ask({
      title: `Join ${tournament.name}?`,
      body: 'You get the fee back if you leave before your table starts.',
      action: `Join for ${tournament.fee.toLocaleString()}`,
      tone: 'brass',
      rows: [
        { label: 'Fee', value: coins(tournament.fee) },
        { label: 'Your coins', value: coins(player.coins) },
        { label: 'Left after joining', value: coins(left), strong: true },
      ],
    })
  }

  async function toggle(tournament: Tournament) {
    const sure = await confirmFee(tournament)
    if (!sure) {
      return
    }

    busy = tournament.id
    error = null

    try {
      if (tournament.joined) {
        await leaveTournament(tournament.id)
      } else {
        await joinTournament(tournament.id)
      }

      await load()
      void refreshCoins()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong. Try again.'
    } finally {
      busy = null
    }
  }
</script>

{#if shownLive.length === 0 && shownOpen.length === 0}
  <p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
    No {gameName} tournaments open for sign-up right now.
  </p>
{:else}
  <div class="relative">
    <!-- Snap scrolling row; the next card peeks in at the edge, so it reads as more to swipe. Every card has a
			 button, so tabbing through them scrolls the row with the keyboard. -->
    <ul
      bind:this={scroller}
      onscroll={updateArrows}
      class="carousel -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
    >
      {#each running as tournament (tournament.id)}
        <RunningTournamentCard
          {tournament}
          {now}
          onstandings={() => showLive(tournament)}
          ontable={(code) => (error = enterTable(tournament.game, code))}
        />
      {/each}
      {#each shownOpen as tournament (tournament.id)}
        {@const status = openStatus(tournament, now)}
        <OpenTournamentCard
          {tournament}
          {status}
          action={actionFor(tournament, status)}
          coinsHeld={player.coins}
          short={shortBy(tournament, player.coins)}
          ondetail={() => showDetail(tournament)}
          onaction={() => toggle(tournament)}
        />
      {/each}
      {#each finished as tournament (tournament.id)}
        <FinishedTournamentCard {tournament} onresults={() => showLive(tournament)} />
      {/each}
    </ul>
    {#if canGoBack}
      <button
        class="arrow absolute top-1/2 -left-5 hidden md:grid"
        onclick={() => page(-1)}
        aria-label="Earlier tournaments"
      >
        <Icon name="back" class="size-5" />
      </button>
    {/if}
    {#if canGoForward}
      <button
        class="arrow absolute top-1/2 -right-5 hidden md:grid"
        onclick={() => page(1)}
        aria-label="More tournaments"
      >
        <Icon name="next" class="size-5" />
      </button>
    {/if}
  </div>
{/if}
{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}

<TournamentLiveDialog
  bind:open={liveOpen}
  tournament={liveDetail}
  game={liveDetail?.game ?? ''}
  back={backOf(liveDetail?.game ?? '')}
  {now}
  onwithdraw={withdraw}
/>

<TournamentDialog
  bind:open={detailOpen}
  tournament={detail}
  status={detailStatus}
  back={backOf(detail?.game ?? '')}
  full={detailStatus === FULL}
  action={detail
    ? actionFor(detail, detailStatus)
    : { label: 'Join', style: 'btn-brass', disabled: true }}
  onaction={() => detail && toggle(detail)}
/>

<style>
  .carousel {
    scrollbar-width: thin;
    scrollbar-color: rgb(243 234 214 / 0.2) transparent;
  }
  /* Phones swipe, and the peeking card already says there is more; the bar would only add a stray line. */
  @media (max-width: 47.99rem) {
    .carousel {
      scrollbar-width: none;
    }
  }
  /* Shown from md up through Tailwind's `hidden md:grid`, so no display here. */
  .arrow {
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    translate: 0 -50%;
    border-radius: 9999px;
    border: 1px solid rgb(243 234 214 / 0.15);
    background: var(--color-panel);
    color: var(--color-paper);
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.45);
  }
  .arrow:hover {
    border-color: rgb(210 165 76 / 0.6);
  }
</style>
