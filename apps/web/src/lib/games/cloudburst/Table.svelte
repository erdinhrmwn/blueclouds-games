<script lang="ts">
  import Dealer from '#lib/components/Dealer.svelte'
  import DealerLine from '#lib/components/DealerLine.svelte'
  import Felt from '#lib/components/Felt.svelte'
  import Seat from '#lib/components/Seat.svelte'
  import HandBar from '#lib/components/HandBar.svelte'
  import WinCascade from '#lib/components/WinCascade.svelte'
  import TournamentNext from '#lib/components/TournamentNext.svelte'
  import ResultDialog from '#lib/components/ResultDialog.svelte'
  import { dealCards, seatRect, whenDealt } from '#lib/motion.ts'
  import {
    type Card,
    DEAL,
    fits,
    HAND_SIZE,
    MAX_PLAYERS,
    type Suit,
    SUITS,
  } from 'contracts/rooms/cloudburst'
  import { must } from 'contracts/must'
  import { prefersReducedMotion } from 'svelte/motion'
  import CloudHand from './CloudHand.svelte'
  import type { CloudburstConnection } from './connection.svelte.ts'
  import { cardCount, dealerLine, nameIn } from './lines.ts'
  import Pile from './Pile.svelte'
  import { Reveal } from './reveal.svelte.ts'
  import RoundSummary from './RoundSummary.svelte'
  import SeatMeter from './SeatMeter.svelte'
  import SuitPicker from './SuitPicker.svelte'

  interface Props {
    room: CloudburstConnection
  }

  let { room }: Props = $props()

  // The room frame shows the table only once the first view arrived.
  const view = $derived(must(room.view, 'room view'))

  const inSeat = (seat: number) => view.players.find((player) => player.seat === seat) ?? null
  const nameOf = (id: string | null | undefined) => nameIn(view, id)

  // Your hand, sorted by suit, then numbers before actions; wild cards last.
  const ORDER = {
    number: 0,
    calm: 1,
    swirl: 2,
    gust: 3,
    downpour: 4,
    rainbow: 5,
    tempest: 6,
  } as const
  /** Wild cards have no suit and sort after every suit. */
  const NO_SUIT_RANK = 9
  const suitRank = (card: Card) => (card.suit ? SUITS.indexOf(card.suit) : NO_SUIT_RANK)

  const hand = $derived(
    [...room.hand.cards].sort(
      (a, b) => suitRank(a) - suitRank(b) || ORDER[a.kind] - ORDER[b.kind] || a.value - b.value,
    ),
  )

  let dealing = $state(false)
  /** While dealing: how many of your cards have landed in your hand so far. */
  let dealtCount = $state(HAND_SIZE)
  const canMove = $derived(room.myTurn && !room.busy && !dealing)

  /** After drawing, only the drawn card may be played. */
  const playable = (card: Card) => {
    if (!view.topCard || !fits(card, view.topCard, view.suit)) {
      return false
    }

    return !view.drew || card.id === room.hand.drawnId
  }

  /** The player after you, in the current direction. */
  const next = $derived.by(() => {
    const mine = view.players.findIndex((player) => player.id === room.playerId)
    const count = view.players.length
    const index = (((mine + view.direction) % count) + count) % count

    return view.players[index] ?? null
  })

  /** A Gust or Rainbow waiting for its second pick before anything is sent. */
  interface Pending {
    card: Card
    needs: 'give' | 'suit'
  }

  // Every turn starts, and ends, with nothing waiting. Kept as its own derived so a new view on the same turn
  // (it changes only when the turn does) leaves the pick alone.
  const myTurn = $derived(room.myTurn)
  let pending = $derived.by((): Pending | null => {
    void myTurn
    return null
  })

  const barLabel = $derived.by(() => {
    if (!room.myTurn) {
      return `${nameOf(view.turnPlayerId)}’s turn`
    }

    if (pending?.needs === 'give') {
      return `Give a card to ${next?.name}`
    }

    if (pending?.needs === 'suit') {
      return `Pick a suit for ${next?.name}`
    }

    return 'Your turn'
  })

  // Your own card flies from where it sat in your hand, so remember that spot on click.
  let placing = $state.raw<{ id: string; rect: DOMRect } | null>(null)

  function send(card: Card, extra: { suit?: Suit; giveId?: string } = {}) {
    const el = document.querySelector(`[data-card="${CSS.escape(card.id)}"]`)
    if (el) {
      placing = { id: card.id, rect: el.getBoundingClientRect() }
    }

    pending = null
    room.play({ cardId: card.id, ...extra }).then(() => {
      if (room.error) {
        placing = null
      }
    })
  }

  function choose(card: Card) {
    if (pending?.needs === 'give') {
      return send(pending.card, { giveId: card.id })
    }

    if (!playable(card)) {
      return
    }

    if (card.suit === null) {
      pending = { card, needs: 'suit' }
    } else if (card.kind === 'gust' && hand.length > 1) {
      pending = { card, needs: 'give' }
    } else {
      send(card)
    }
  }

  /** Who played the top card: the player, or whoever went out with it. */
  const lastPlayer = $derived.by(() => {
    const event = view.lastEvent
    if (event?.type === 'played') {
      return event.playerId
    }

    if (event?.type === 'roundEnd') {
      return event.outId
    }

    return null
  })

  const flightFrom = (id: string) => (placing?.id === id ? placing.rect : seatRect(lastPlayer))

  const SKIPPED_BADGE_MS = 1600
  /** How long a played card keeps its own flight start after it left your hand. */
  const PLACING_CLEAR_MS = 500
  const DRAW_FLIGHT_MS = 450
  const GIVE_FLIGHT_MS = 550
  const CLOCK_TICK_MS = 250

  const reveal = new Reveal()

  // Table events, each handled once (by `moves`): deals, draws, gusts, skips and the round summary.
  type RoundEnd = Extract<NonNullable<typeof view.lastEvent>, { type: 'roundEnd' }>
  let skipped = $state<string | null>(null)

  /** The badge on a seat: skipped this turn, else how many cards it holds (the badge draws a card beside it). */
  const cardsLabel = (playerId: string, cards: number) => {
    if (skipped === playerId) {
      return 'Skipped'
    }

    return String(cards)
  }

  /** A seat's badge and meter in words, for screen readers. */
  const seatSummary = (player: (typeof view.players)[number]) => {
    const points = `${player.points} of ${view.burstAt} points`
    if (skipped === player.id) {
      return `skipped, ${points}`
    }

    return `${cardCount(player.cards)}, ${points}`
  }

  let summary = $state<RoundEnd | null>(null)
  let handled = -1

  $effect(() => {
    const event = view.lastEvent
    if (view.moves === handled || !event) {
      return
    }

    handled = view.moves

    const still = prefersReducedMotion.current
    const deck = () => document.querySelector('[data-deck]')?.getBoundingClientRect() ?? null

    if (event.type === 'roundEnd') {
      summary = event
      if (event.next === 'round') {
        setTimeout(() => {
          summary = null
        }, DEAL.roundEndMs)
      }
    }

    const newRound = event.type === 'dealt' || event.type === 'roundEnd'
    if (view.phase === 'playing' && newRound) {
      const wait = event.type === 'roundEnd' ? DEAL.roundEndMs : 0
      const seats = view.players.map((player) => player.id)
      const dealMs = seats.length * HAND_SIZE * DEAL.stepMs + DEAL.flightMs

      dealing = true
      dealtCount = still ? HAND_SIZE : 0
      setTimeout(() => {
        dealCards(deck(), seats.map(seatRect), { passes: HAND_SIZE, ...DEAL })
      }, wait)

      if (!still) {
        const mine = seats.indexOf(room.playerId ?? '')
        whenDealt(mine, seats.length, { passes: HAND_SIZE, ...DEAL }, wait, (count) => {
          dealtCount = count
        })
      }

      setTimeout(() => {
        dealing = false
      }, wait + dealMs)
    }

    if (still) {
      return
    }

    if (event.type === 'roundEnd') {
      reveal.start(view.moves, event.left)
    }

    if (event.type === 'drew' && event.got) {
      dealCards(deck(), [seatRect(event.playerId)], {
        passes: 1,
        stepMs: 0,
        flightMs: DRAW_FLIGHT_MS,
      })
    }

    if (event.type === 'played' && event.gaveTo) {
      dealCards(seatRect(event.playerId), [seatRect(event.gaveTo)], {
        passes: 1,
        stepMs: 0,
        flightMs: GIVE_FLIGHT_MS,
      })
    }

    if (event.type === 'played' && event.skipped) {
      const id = event.skipped
      skipped = id
      setTimeout(() => {
        if (skipped === id) {
          skipped = null
        }
      }, SKIPPED_BADGE_MS)
    }
  })

  // Once the played card left your hand (the server took it), the pile's flight no longer needs its spot.
  $effect(() => {
    const id = placing?.id
    if (!id || room.hand.cards.some((card) => card.id === id)) {
      return
    }

    setTimeout(() => {
      if (placing?.id === id) {
        placing = null
      }
    }, PLACING_CLEAR_MS)
  })

  // Ticks while a turn timer runs; the deadline itself comes from the server.
  let now = $state(Date.now())
  $effect(() => {
    if (room.turnEndsAt === null) {
      return
    }

    const id = setInterval(() => {
      now = Date.now()
    }, CLOCK_TICK_MS)
    return () => clearInterval(id)
  })

  const msLeft = $derived(room.turnEndsAt === null ? null : Math.max(0, room.turnEndsAt - now))
  const secondsLeft = $derived(msLeft === null ? null : Math.ceil(msLeft / 1000))
  const drain = $derived.by(() => {
    if (room.turnEndsAt === null) {
      return null
    }

    return { ms: Math.max(0, room.turnEndsAt - Date.now()), total: room.turnTotal }
  })

  const line = $derived(dealerLine(view))

  const standings = $derived([...view.players].sort((a, b) => a.points - b.points))
  const iWon = $derived(view.winnerId !== null && view.winnerId === room.playerId)
  /** The finished table's result popup; it opens by itself, and "See the result" opens it again. */
  let resultOpen = $state(false)

  /** The result heading: a win, a loss for a seated player, else who won. */
  const resultTitle = $derived.by(() => {
    if (iWon) {
      return 'You win'
    }

    return room.me ? 'You lost this one' : 'Winner'
  })

  function onKey(event: KeyboardEvent) {
    const typing = event.target instanceof HTMLInputElement
    if (typing || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    if (event.key === 'Escape' && pending?.needs === 'give') {
      pending = null
    }

    if (!canMove || pending) {
      return
    }

    if (event.key === 'd' && !view.drew) {
      room.draw()
    }

    if (event.key === 'p' && view.drew) {
      room.pass()
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="table-back-cloudburst shrink-0">
  <Felt count={MAX_PLAYERS + 1} name="Cloudburst" direction={view.direction}>
    {#snippet seat(spot)}
      {#if spot === 0}
        <Dealer />
      {:else}
        {@const player = inSeat(spot - 1)}
        {#snippet cardsBadge()}
          {#if player}
            {@const cards = reveal.cardsOf(player)}
            <span
              class="flex items-center gap-1 tabular-nums {cards === 1 && skipped !== player.id
                ? 'text-ember'
                : 'text-paper/90'}"
            >
              {#if skipped !== player.id}
                <!-- a card -->
                <svg
                  viewBox="0 0 12 16"
                  class="h-3 w-2.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                >
                  <rect x="1" y="1" width="10" height="14" rx="2" />
                </svg>
              {/if}
              {cardsLabel(player.id, cards)}
            </span>
          {/if}
        {/snippet}
        {#snippet meter()}
          {#if player}
            <SeatMeter {player} burstAt={view.burstAt} {reveal} />
          {/if}
        {/snippet}
        <Seat
          {player}
          number={spot}
          isTurn={!!player && (player.id === view.turnPlayerId || player.id === view.winnerId)}
          isMe={!!player && player.id === room.playerId}
          out={!!player && skipped === player.id}
          badge={player ? cardsBadge : undefined}
          meter={player ? meter : undefined}
          summary={player ? seatSummary(player) : undefined}
          timeLeft={player && player.id === view.turnPlayerId && msLeft !== null
            ? Math.min(1, msLeft / room.turnTotal)
            : null}
          drain={player && player.id === view.turnPlayerId ? drain : null}
        />
      {/if}
    {/snippet}

    {#if view.phase === 'finished'}
      <WinCascade />
    {/if}
    <!-- The pile stays when the table finishes; the result is a popup. -->
    {#if summary && view.phase !== 'finished'}
      <RoundSummary
        outName={nameOf(summary.outId)}
        {standings}
        gained={summary.gained}
        burstAt={view.burstAt}
        tie={summary.tie}
      />
    {:else}
      <Pile
        deckCount={view.deckCount}
        suit={view.suit}
        topCard={view.topCard}
        pileUnder={view.pileUnder}
        {flightFrom}
      />
    {/if}
  </Felt>
</div>

<DealerLine text={line} moveKey={view.moves} />

{#if view.phase === 'finished'}
  <div class="flex flex-1 items-center justify-center">
    <button class="btn-brass" onclick={() => (resultOpen = true)}>See the result</button>
  </div>
  <ResultDialog bind:open={resultOpen} title={resultTitle} winner={nameOf(view.winnerId)}>
    {#snippet details()}
      <ol
        class="mx-auto grid max-w-xs grid-cols-2 gap-x-4 text-sm tabular-nums"
        aria-label="Final points"
      >
        {#each standings as player (player.id)}
          <li class={player.id === view.winnerId ? 'text-brass' : 'text-paper/80'}>
            {player.name}: {player.points}
          </li>
        {/each}
      </ol>
    {/snippet}
    {#snippet actions()}
      {#if view.tournament?.id}
        <TournamentNext
          game={room.game}
          tournamentId={view.tournament.id}
          tournamentName={view.tournament.name}
          round={view.tournament.round ?? 1}
          onchange={() => (resultOpen = true)}
        />
      {:else if view.tournament}
        <p class="text-sm text-paper/75">This {view.tournament.name} table is done.</p>
      {:else if room.isHost}
        <button class="btn-brass w-full" onclick={room.reset} disabled={room.busy}
          >Shuffle &amp; play again</button
        >
      {:else}
        <p class="text-sm text-paper/75">Waiting for the host to open a new table…</p>
      {/if}
    {/snippet}
  </ResultDialog>
{/if}

{#if view.phase === 'playing' && room.me}
  <SuitPicker
    open={pending?.needs === 'suit'}
    nextName={next?.name ?? ''}
    {secondsLeft}
    onpick={(suit) => pending && send(pending.card, { suit })}
  />

  <HandBar active={room.myTurn} label={barLabel} {secondsLeft}>
    {#snippet actions()}
      {#if pending?.needs === 'give'}
        <button class="link-btn" onclick={() => (pending = null)}>Cancel</button>
      {:else if pending}
        <!-- A Rainbow can't be taken back: no Cancel while its suit is picked. -->
      {:else if view.drew}
        <button class="btn-chip" onclick={room.pass} disabled={!canMove}>
          Pass <kbd class="key-hint">P</kbd>
        </button>
      {:else}
        <button class="btn-chip" onclick={room.draw} disabled={!canMove}>
          Draw <kbd class="key-hint">D</kbd>
        </button>
      {/if}
    {/snippet}

    <CloudHand
      {hand}
      myTurn={room.myTurn}
      {canMove}
      {dealing}
      {dealtCount}
      placingId={placing?.id ?? null}
      pendingId={pending?.card.id ?? null}
      giving={pending?.needs === 'give'}
      drawnId={view.drew ? room.hand.drawnId : null}
      {playable}
      onchoose={choose}
    />
  </HandBar>
{/if}
