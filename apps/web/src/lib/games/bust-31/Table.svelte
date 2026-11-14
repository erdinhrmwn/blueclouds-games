<script lang="ts">
	import type { Bust31Connection } from './connection.svelte.ts';
	import { dealCards, placeCard, seatRect, shake, whenDealt } from '#lib/motion.ts';
	import type { Card } from 'server/games/bust-31/rules';
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import BustStamp from './BustStamp.svelte';
	import Felt from '#lib/components/Felt.svelte';
	import WinCascade from '#lib/components/WinCascade.svelte';
	import TournamentNext from '#lib/components/TournamentNext.svelte';
	import ResultDialog from '#lib/components/ResultDialog.svelte';
	import PlayingCard from './PlayingCard.svelte';
	import Seat from '#lib/components/Seat.svelte';
	import HandBar from '#lib/components/HandBar.svelte';
	import { DEAL, HAND_SIZE, MAX_PLAYERS, START_LIVES } from 'server/games/bust-31/rules';
	import Dealer from '#lib/components/Dealer.svelte';
	import DealerLine from '#lib/components/DealerLine.svelte';
	import TotalTrack from './TotalTrack.svelte';

	let { room }: { room: Bust31Connection } = $props();

	const BUST_STAMP_MS = 1800;
	const CLOCK_TICK_MS = 250;
	/** Where a card played by someone else starts its spin, in degrees. */
	const OTHER_PLAYER_TILT = -25;

	/** Phones get a smaller pile so the middle of the table stays clear of the seats. */
	const pileSize = 'pile';
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
		if (view.phase !== 'playing') {
			return;
		}

		if (event?.type !== 'started' && event?.type !== 'bust') {
			return;
		}

		if (dealtMoves === view.moves) {
			return;
		}

		dealtMoves = view.moves;
		if (prefersReducedMotion.current) {
			return;
		}

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
			if (room.error) {
				placing = null;
			}
		});
	}

	// The pile's fly-in has read `placing` by the time the new hand arrives (it follows the view).
	$effect(() => {
		if (placing && room.hand !== placing.hand) {
			placing = null;
		}
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
		if (event?.type !== 'bust') {
			return;
		}

		if (untrack(() => bust?.moves) === view.moves) {
			return;
		}

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
			if (bust?.moves === moves) {
				bust = null;
			}
		}, BUST_STAMP_MS);
		return () => clearTimeout(id);
	});

	/** The finished table's result popup; it opens by itself, and "See the result" opens it again. */
	let resultOpen = $state(false);
	const iWon = $derived(view.winnerId !== null && view.winnerId === room.playerId);

	/** The result heading: a win, a loss for a seated player, else who won. */
	const resultTitle = $derived.by(() => {
		if (iWon) {
			return 'You win';
		}

		return room.me ? 'You lost this one' : 'Winner';
	});

	// Ticks while a turn timer runs; the deadline itself comes from the server.
	let now = $state(Date.now());
	$effect(() => {
		if (room.turnEndsAt === null) {
			return;
		}

		const id = setInterval(() => {
			now = Date.now();
		}, CLOCK_TICK_MS);
		return () => clearInterval(id);
	});

	const msLeft = $derived(room.turnEndsAt === null ? null : Math.max(0, room.turnEndsAt - now));
	const secondsLeft = $derived(msLeft === null ? null : Math.ceil(msLeft / 1000));
	// Snapshot taken once per deadline; the bar and ring animate down from it every frame.
	const drain = $derived.by(() => {
		if (room.turnEndsAt === null) {
			return null;
		}

		return { ms: Math.max(0, room.turnEndsAt - Date.now()), total: room.turnTotal };
	});

	/**
	 * Which side a chair fans its card backs: towards the middle of the table, except the two chairs at the
	 * top of the arms, which fan outward to stay clear of the dealer's shoe and the turn direction.
	 */
	const backsSide = (chair: number): 'left' | 'right' => {
		const right = chair <= MAX_PLAYERS / 2;
		const topCorner = chair === 1 || chair === MAX_PLAYERS;
		if (topCorner) {
			return right ? 'right' : 'left';
		}

		return right ? 'left' : 'right';
	};

	const nameOf = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '?';

	/** After a Double the player on turn plays 2 cards; older servers send no playsLeft. */
	const playsLeft = $derived(view.playsLeft ?? 1);
	const turnLabel = $derived.by(() => {
		const owner = room.myTurn ? 'Your turn' : `${nameOf(view.turnPlayerId)}’s turn`;
		if (playsLeft > 1) {
			return `${owner}, ${playsLeft} cards`;
		}

		return owner;
	});

	/** "+7", "−5", "a reverse", "a Ten" or "0", as the dealer says it. */
	const SPOKEN_SPECIAL: Record<Exclude<Card['kind'], 'number'>, string> = {
		zero: '0',
		minus: '−5',
		reverse: 'a reverse',
		swap: 'a Swap',
		ten: 'a Ten',
		double: 'a Double'
	};

	function spokenCard(card: Card): string {
		if (card.kind === 'number') {
			return `+${card.value}`;
		}

		return SPOKEN_SPECIAL[card.kind];
	}

	/** What a special card did, after "played …": who swapped, the new total, who plays twice. */
	function cardOutcome(event: { card: Card; total: number; swappedWith?: string }): string {
		if (event.card.kind === 'swap' && event.swappedWith) {
			return ` and swapped hands with ${nameOf(event.swappedWith)}`;
		}

		if (event.card.kind === 'ten') {
			return '. The total is 10';
		}

		if (event.card.kind === 'double') {
			return `. ${nameOf(view.turnPlayerId)} plays 2 cards`;
		}

		return '';
	}

	const dealerLine = $derived.by(() => {
		const event = view.lastEvent;
		if (!event) {
			return '';
		}

		switch (event.type) {
			case 'started':
				return `Hand ${view.round}. Cards dealt.`;
			case 'joined':
				return `${nameOf(event.playerId)} sat down.`;
			case 'played': {
				const auto = event.auto ? ' (auto, time ran out)' : '';
				return `${nameOf(event.playerId)} played ${spokenCard(event.card)}${cardOutcome(event)}${auto}.`;
			}
			case 'bust': {
				const auto = event.auto ? ' (auto, time ran out)' : '';
				const outcome = event.eliminated ? 'Out of the game.' : `Loses a life. Hand ${view.round}.`;
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
<div bind:this={tableEl} class="table-back-bust-31 overflow-x-clip">
	<Felt count={MAX_PLAYERS + 1} name="Bust 31">
		{#snippet seat(spot)}
			{#if spot === 0}
				<Dealer deckCount={view.deckCount} direction={view.direction} />
			{:else}
				{@const player = inSeat(spot - 1)}
				{#snippet lives()}
					<span
						class="flex items-center gap-0.5"
						role="img"
						aria-label="{player?.lives} of {START_LIVES} lives"
					>
						{#each Array(START_LIVES) as _, i (i)}
							{@const kept = i < (player?.lives ?? 0)}
							<svg
								viewBox="0 0 24 24"
								class="size-3 {kept ? 'text-ember' : 'text-paper/60'}"
								fill={kept ? 'currentColor' : 'none'}
								stroke="currentColor"
								stroke-width="2"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path
									d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.9 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.4 0 5.7 3.3 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3Z"
								/>
							</svg>
						{/each}
					</span>
				{/snippet}
				<Seat
					{player}
					number={spot}
					cards={player && player.lives > 0 ? HAND_SIZE : 0}
					cardSide={backsSide(spot)}
					isTurn={!!player && (player.id === view.turnPlayerId || player.id === view.winnerId)}
					isHost={!!player && player.id === view.hostId}
					isMe={!!player && player.id === room.playerId}
					out={!!player && player.lives === 0}
					status={player ? lives : undefined}
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
		<!-- The pile on top, the total's track under it. It stays when the table finishes; the result is a popup. -->
		<div class="flex translate-y-2 flex-col items-center gap-4 sm:gap-5">
			<div
				class="grid h-[3.55rem] w-10 place-items-center rounded-lg border border-dashed border-paper/40 sm:h-[4.6rem] sm:w-[3.25rem]"
			>
				{#each under as u (u.id)}
					<div class="col-start-1 row-start-1" style="rotate: {tiltOf(u.id)}deg" aria-hidden="true">
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
			<TotalTrack total={view.total} limit={view.limit} />
		</div>
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

<DealerLine text={dealerLine} moveKey={view.moves} />

{#if view.phase === 'finished'}
	<div class="flex justify-center">
		<button class="btn-brass" onclick={() => (resultOpen = true)}>See the result</button>
	</div>
	<ResultDialog bind:open={resultOpen} title={resultTitle} winner={nameOf(view.winnerId)}>
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

{#if view.phase === 'playing'}
	{#if room.me && room.me.lives > 0}
		<section aria-label="Your hand" class="flex flex-col items-center gap-4">
			<HandBar active={room.myTurn} label={turnLabel} {secondsLeft} />
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
		</section>
	{:else}
		<p class="text-center text-sm text-paper/75">You are out. Watch until the table finishes.</p>
	{/if}
{/if}
