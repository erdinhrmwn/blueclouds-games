<script lang="ts">
	import type { Bust31Connection } from './connection.svelte.ts';
	import { dealCards, placeCard, seatRect, shake, whenDealt } from '#lib/motion.ts';
	import type { Card } from 'server/games/bust-31/rules';
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import BustStamp from './BustStamp.svelte';
	import Felt from '#lib/components/Felt.svelte';
	import WinCascade from '#lib/components/WinCascade.svelte';
	import PlayingCard from './PlayingCard.svelte';
	import Seat from '#lib/components/Seat.svelte';
	import { DEAL, HAND_SIZE, MAX_PLAYERS, START_LIVES } from 'server/games/bust-31/rules';
	import Dealer from '#lib/components/Dealer.svelte';
	import DealerLine from '#lib/components/DealerLine.svelte';
	import TotalGauge from './TotalGauge.svelte';

	let { room }: { room: Bust31Connection } = $props();

	const BUST_STAMP_MS = 1800;
	const CLOCK_TICK_MS = 250;
	/** Where a card played by someone else starts its spin, in degrees. */
	const OTHER_PLAYER_TILT = -25;

	/** Phones get a smaller pile so the middle of the table stays clear of the seats. */
	const wide = new MediaQuery('min-width: 640px');
	const pileSize = $derived(wide.current ? 'md' : 'sm');
	const view = $derived(room.view!);

	// Fixed chairs: everyone sees the same table, dealer at the head.
	const inSeat = (seat: number) => view.players.find((p) => p.seat === seat) ?? null;

	// The dealer deals every new round (game start, or after a bust once its stamp has shown).
	// The server holds the first turn until this ends; your cards turn up one by one as they land.
	let dealing = $state(false);
	/** While dealing: how many of your cards have landed in your hand so far. */
	let dealtCount = $state(HAND_SIZE);
	let dealtMoves: number | null = null;
	$effect(() => {
		const event = view.lastEvent;
		if (view.phase !== 'playing') return;
		if (event?.type !== 'started' && event?.type !== 'bust') return;
		if (dealtMoves === view.moves) return;

		dealtMoves = view.moves;
		if (prefersReducedMotion.current) return;

		const seats = view.players.filter((p) => p.lives > 0).map((p) => p.id);
		const wait = event.type === 'bust' ? DEAL.afterBustMs : 0;
		const dealMs = seats.length * HAND_SIZE * DEAL.stepMs + DEAL.flightMs;
		dealing = true;
		dealtCount = 0;

		// Timers are not cleared on re-run: every server update re-runs this effect, and the deal must finish.
		setTimeout(() => {
			const deck = document.querySelector('[data-deck]')?.getBoundingClientRect() ?? null;
			dealCards(deck, seats.map(seatRect), { passes: HAND_SIZE, ...DEAL });
		}, wait);

		const mine = seats.indexOf(room.playerId ?? '');
		whenDealt(mine, seats.length, { passes: HAND_SIZE, ...DEAL }, wait, (count) => {
			dealtCount = count;
		});

		setTimeout(() => {
			dealing = false;
		}, wait + dealMs);
	});

	// Whoever played the card now on the pile; the new card flies in from their seat.
	const lastPlayer = $derived(view.lastEvent?.type === 'played' ? view.lastEvent.playerId : null);

	// Your own card flies from where it sat in your hand, so remember that spot on click.
	// It is hidden in the hand meanwhile, so it never shows twice while the server answers.
	// Card ids repeat across rounds and reshuffles, so this is tied to the hand it was clicked
	// in: the next hand from the server (new round included) must show every card it holds.
	let placing = $state.raw<{ id: string; rect: DOMRect; tilt: number; hand: Card[] } | null>(null);

	function play(cardId: string) {
		const el = document.querySelector(`[data-card="${CSS.escape(cardId)}"]`);
		const index = room.hand.findIndex((card) => card.id === cardId);

		if (el) {
			placing = {
				id: cardId,
				rect: el.getBoundingClientRect(),
				tilt: fanAngle(index, room.hand.length),
				hand: room.hand
			};
		}

		room.play(cardId).then(() => {
			// Rejected: show the card again.
			if (room.error) placing = null;
		});
	}

	// The pile's fly-in has read `placing` by the time the new hand arrives (it follows the view).
	$effect(() => {
		if (placing && room.hand !== placing.hand) placing = null;
	});
	const flightFrom = (cardId: string) =>
		placing?.id === cardId ? placing.rect : seatRect(lastPlayer);
	const flightTilt = (cardId: string) =>
		placing?.id === cardId ? placing.tilt : OTHER_PLAYER_TILT;

	// Cards played earlier stay visible under the top one, each at its own slight angle (-6..6).
	const tiltOf = (id: string) => {
		const hash = [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7);
		return (hash % 13) - 6;
	};

	// They come from the server, so a refresh mid-round shows the same pile.
	const under = $derived(view.pileUnder);

	// A bust clears the pile (new round), so the busting card is shown on its own for a moment.
	let tableEl = $state<HTMLElement>();
	let bust = $state<{
		moves: number;
		card: Card;
		total: number;
		playerId: string;
		eliminated: boolean;
	} | null>(null);

	$effect(() => {
		const event = view.lastEvent;
		if (event?.type !== 'bust') return;
		if (untrack(() => bust?.moves) === view.moves) return;

		const moves = view.moves;
		bust = {
			moves,
			card: event.card,
			total: event.total,
			playerId: event.playerId,
			eliminated: event.eliminated
		};
		shake(tableEl);

		const id = setTimeout(() => {
			if (bust?.moves === moves) bust = null;
		}, BUST_STAMP_MS);
		return () => clearTimeout(id);
	});

	const iWon = $derived(view.winnerId !== null && view.winnerId === room.playerId);

	// Ticks while a turn timer runs; the deadline itself comes from the server.
	let now = $state(Date.now());
	$effect(() => {
		if (room.turnEndsAt === null) return;

		const id = setInterval(() => {
			now = Date.now();
		}, CLOCK_TICK_MS);
		return () => clearInterval(id);
	});

	const msLeft = $derived(room.turnEndsAt === null ? null : Math.max(0, room.turnEndsAt - now));
	const secondsLeft = $derived(msLeft === null ? null : Math.ceil(msLeft / 1000));
	// Snapshot taken once per deadline; the bar and ring animate down from it every frame.
	const drain = $derived.by(() => {
		if (room.turnEndsAt === null) return null;
		return { ms: Math.max(0, room.turnEndsAt - Date.now()), total: room.turnTotal };
	});

	const nameOf = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '?';

	/** "+7", "−5", "a reverse" or "0", as the dealer says it. */
	function spokenCard(card: Card): string {
		if (card.kind === 'number') return `+${card.value}`;
		if (card.kind === 'minus') return '−5';
		if (card.kind === 'reverse') return 'a reverse';
		return '0';
	}

	const dealerLine = $derived.by(() => {
		const event = view.lastEvent;
		if (!event) return '';

		switch (event.type) {
			case 'started':
				return `Round ${view.round}. Cards dealt.`;
			case 'joined':
				return `${nameOf(event.playerId)} sat down.`;
			case 'played': {
				const auto = event.auto ? ' (auto, time ran out)' : '';
				return `${nameOf(event.playerId)} played ${spokenCard(event.card)}${auto}.`;
			}
			case 'bust': {
				const auto = event.auto ? ' (auto, time ran out)' : '';
				const outcome = event.eliminated
					? 'Out of the game.'
					: `Loses a life. Round ${view.round}.`;
				return `${nameOf(event.playerId)} busted at ${event.total}${auto}. ${outcome}`;
			}
			case 'finished':
				return `${nameOf(event.winnerId)} wins the table.`;
		}
	});

	/** Your hand fans out: each card turns 7° and drops 6px per step away from the middle. */
	const fanAngle = (index: number, count: number) => (index - (count - 1) / 2) * 7;
	const fan = (index: number, count: number) => {
		const drop = Math.abs(index - (count - 1) / 2) * 6;
		return `transform: rotate(${fanAngle(index, count)}deg) translateY(${drop}px)`;
	};
</script>

<!-- clip sideways only, so cards flying in mid-animation never add a horizontal scrollbar on phones -->
<div bind:this={tableEl} class="overflow-x-clip">
	<Felt count={MAX_PLAYERS + 1}>
		{#snippet seat(k)}
			{#if k === 0}
				<Dealer deckCount={view.deckCount} direction={view.direction} />
			{:else}
				{@const p = inSeat(k - 1)}
				{#snippet lives()}
					<span
						class="flex items-center gap-1"
						role="img"
						aria-label="{p?.lives} of {START_LIVES} lives"
					>
						{#each Array(START_LIVES) as _, i (i)}
							<span
								class="size-2 rounded-full {i < (p?.lives ?? 0)
									? 'bg-ember'
									: 'border border-paper/60'}"
							></span>
						{/each}
					</span>
				{/snippet}
				<Seat
					player={p}
					number={k}
					isTurn={!!p && (p.id === view.turnPlayerId || p.id === view.winnerId)}
					isHost={!!p && p.id === view.hostId}
					isMe={!!p && p.id === room.playerId}
					out={!!p && p.lives === 0}
					status={p ? lives : undefined}
					timeLeft={p && p.id === view.turnPlayerId && msLeft !== null
						? Math.min(1, msLeft / room.turnTotal)
						: null}
					drain={p && p.id === view.turnPlayerId ? drain : null}
				/>
			{/if}
		{/snippet}

		{#if view.phase === 'finished'}
			<WinCascade />
			<div class="relative flex flex-col items-center gap-3 text-center">
				<p
					class="label"
					in:fly={{ y: 10, duration: prefersReducedMotion.current ? 0 : 300, delay: 200 }}
				>
					{iWon ? 'You win' : room.me ? 'You lost this one' : 'Winner'}
				</p>
				<p
					class="winner font-display text-4xl font-black text-brass sm:text-5xl"
					class:still={prefersReducedMotion.current}
				>
					{nameOf(view.winnerId)}
				</p>
				{#if view.tournament}
					<p class="text-sm text-paper/75">This {view.tournament.name} table is done.</p>
				{:else if room.isHost}
					<button class="btn-brass mt-2" onclick={room.reset} disabled={room.busy}
						>Shuffle &amp; play again</button
					>
				{:else}
					<p class="text-sm text-paper/75">Waiting for the host to open a new table…</p>
				{/if}
			</div>
		{:else}
			<!-- From tablet width the pile sits dead centre with the gauge beside it; phones stack them. -->
			<div class="flex flex-col items-center gap-4 sm:relative sm:block">
				<div class="sm:absolute sm:top-1/2 sm:right-full sm:mr-8 sm:-translate-y-1/2">
					<TotalGauge total={view.total} limit={view.limit} />
				</div>
				<div
					class="grid h-20 w-14 place-items-center rounded-lg sm:h-[6.75rem] sm:w-[4.75rem] border border-dashed border-paper/40"
				>
					{#each under as u (u.id)}
						<div
							class="col-start-1 row-start-1"
							style="rotate: {tiltOf(u.id)}deg"
							aria-hidden="true"
						>
							<PlayingCard card={u} size={pileSize} />
						</div>
					{/each}
					{#key view.topCard?.id}
						{#if view.topCard}
							<div
								class="col-start-1 row-start-1"
								data-pile-top
								in:placeCard|global={{
									from: flightFrom(view.topCard.id),
									tilt: flightTilt(view.topCard.id)
								}}
							>
								<div style="rotate: {tiltOf(view.topCard.id)}deg">
									<PlayingCard card={view.topCard} size={pileSize} />
								</div>
							</div>
						{/if}
					{/key}
				</div>
			</div>
		{/if}
		{#if bust}
			{#key bust.moves}
				<BustStamp
					card={bust.card}
					total={bust.total}
					playerId={bust.playerId}
					eliminated={bust.eliminated}
				/>
			{/key}
		{/if}
	</Felt>
</div>

<DealerLine text={dealerLine} />

{#if view.phase === 'playing'}
	{#if room.me && room.me.lives > 0}
		<section aria-label="Your hand" class="flex flex-col items-center gap-4">
			<p
				class="text-sm font-semibold {room.myTurn ? 'text-brass' : 'text-paper/75'}"
				aria-live="polite"
			>
				{room.myTurn ? 'Your turn. Pick a card.' : `Waiting for ${nameOf(view.turnPlayerId)}`}
			</p>
			<!-- The countdown itself is the ring on the seat; screen readers get one warning instead. -->
			{#if room.myTurn && secondsLeft !== null && secondsLeft <= 5}
				<p class="sr-only" role="alert">Time is almost up.</p>
			{/if}
			<div class="flex justify-center px-4 pt-2" class:pointer-events-none={dealing}>
				{#each room.hand as card, i (card.id)}
					{@const landed = !dealing || i < dealtCount}
					<div
						class="-mx-1.5 sm:mx-0.5 {dealing && landed ? 'dealt-in' : ''}"
						class:invisible={placing?.id === card.id || !landed}
						style={fan(i, room.hand.length)}
						data-card={card.id}
					>
						<PlayingCard {card} size="lg" disabled={!room.myTurn || room.busy} onplay={play} />
					</div>
				{/each}
			</div>
			{#if room.myTurn && secondsLeft !== null}
				<p class="text-xs text-paper/75">If time runs out, a card is played for you.</p>
			{/if}
		</section>
	{:else}
		<p class="text-center text-sm text-paper/75">You are out. Watch until the table finishes.</p>
	{/if}
{/if}

<style>
	/* Winner's name rises out of the table, then settles with a slow glow. */
	.winner {
		animation:
			rise 700ms cubic-bezier(0.2, 0.8, 0.3, 1.2) both,
			glow 2.4s ease-in-out 700ms infinite alternate;
	}
	.winner.still {
		animation: none;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(24px) scale(0.6);
		}
	}
	@keyframes glow {
		to {
			text-shadow: 0 0 24px rgb(210 165 76 / 0.55);
		}
	}
</style>
