<script lang="ts">
	import type { RoomConnection } from './connection.svelte.ts';
	import { placeCard, seatRect, shake } from '#lib/motion.ts';
	import type { Card } from 'server/games/bust-31/rules';
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import BustStamp from './BustStamp.svelte';
	import Felt from '#lib/components/Felt.svelte';
	import WinCascade from './WinCascade.svelte';
	import PlayingCard from './PlayingCard.svelte';
	import Seat from '#lib/components/Seat.svelte';
	import TotalGauge from './TotalGauge.svelte';
	import { TURN_MS } from 'server/games/bust-31/rules';

	let { room }: { room: RoomConnection } = $props();
	const view = $derived(room.view!);

	// Rotate seats so the viewer always sits at the bottom of the table.
	const myIndex = $derived(Math.max(0, view.players.findIndex((p) => p.id === room.playerId)));
	const seatAt = (k: number) => view.players[(myIndex + k) % view.players.length]!;
	// Whoever played the card now on the pile; the new card flies in from their seat.
	const lastPlayer = $derived(view.lastEvent?.type === 'played' ? view.lastEvent.playerId : null);

	// Your own card flies from where it sat in your hand, so remember that spot on click.
	// It is hidden in the hand meanwhile, so it never shows twice while the server answers.
	let placing = $state<{ id: string; rect: DOMRect; tilt: number } | null>(null);
	function play(cardId: string) {
		const el = document.querySelector(`[data-card="${CSS.escape(cardId)}"]`);
		const i = room.hand.findIndex((c) => c.id === cardId);
		if (el) placing = { id: cardId, rect: el.getBoundingClientRect(), tilt: fanAngle(i, room.hand.length) };
		room.play(cardId).then(() => {
			if (room.error) placing = null; // rejected: show the card again
		});
	}
	const flightFrom = (cardId: string) => (placing?.id === cardId ? placing.rect : seatRect(lastPlayer));
	const flightTilt = (cardId: string) => (placing?.id === cardId ? placing.tilt : -25);

	// Cards played earlier stay visible under the top one, each at its own slight angle.
	const tiltOf = (id: string) => ([...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) % 13) - 6;
	let under = $state<{ id: string; card: Card }[]>([]);
	let shownTop: Card | null = null;
	$effect(() => {
		const top = view.topCard;
		if (top?.id === shownTop?.id) return;
		under = top && shownTop ? [...untrack(() => under), { id: shownTop.id, card: shownTop }].slice(-3) : [];
		shownTop = top;
	});

	// A bust clears the pile (new round), so the busting card is shown on its own for a moment.
	let tableEl = $state<HTMLElement>();
	let bust = $state<{ moves: number; card: Card; total: number; playerId: string; eliminated: boolean } | null>(null);
	$effect(() => {
		const e = view.lastEvent;
		if (e?.type !== 'bust' || untrack(() => bust?.moves) === view.moves) return;
		bust = { moves: view.moves, card: e.card, total: e.total, playerId: e.playerId, eliminated: e.eliminated };
		shake(tableEl);
		const moves = view.moves;
		const id = setTimeout(() => {
			if (bust?.moves === moves) bust = null;
		}, 1800);
		return () => clearTimeout(id);
	});
	const iWon = $derived(view.winnerId !== null && view.winnerId === room.playerId);

	// Ticks while a human turn timer runs; the deadline itself comes from the server.
	let now = $state(Date.now());
	$effect(() => {
		if (room.turnEndsAt === null) return;
		const id = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(id);
	});
	const msLeft = $derived(room.turnEndsAt === null ? null : Math.max(0, room.turnEndsAt - now));
	const secondsLeft = $derived(msLeft === null ? null : Math.ceil(msLeft / 1000));
	// Snapshot taken once per deadline; the bar and ring animate down from it every frame.
	const drain = $derived(room.turnEndsAt === null ? null : { ms: Math.max(0, room.turnEndsAt - Date.now()), total: TURN_MS });

	const nameOf = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '?';

	const dealerLine = $derived.by(() => {
		const e = view.lastEvent;
		if (!e) return '';
		switch (e.type) {
			case 'started':
				return `Round ${view.round}. Cards dealt.`;
			case 'joined':
				return `${nameOf(e.playerId)} sat down.`;
			case 'played':
				return `${nameOf(e.playerId)} played ${e.card.kind === 'number' ? `+${e.card.value}` : e.card.kind === 'minus' ? '−5' : e.card.kind === 'reverse' ? 'a reverse' : '0'}${e.auto ? ' (auto, time ran out)' : ''}.`;
			case 'bust':
				return `${nameOf(e.playerId)} busted at ${e.total}${e.auto ? ' (auto, time ran out)' : ''}. ${e.eliminated ? 'Out of the game.' : `Loses a life. Round ${view.round}.`}`;
			case 'finished':
				return `${nameOf(e.winnerId)} wins the table.`;
		}
	});

	const fanAngle = (i: number, n: number) => (i - (n - 1) / 2) * 7;
	const fan = (i: number, n: number) => `transform: rotate(${fanAngle(i, n)}deg) translateY(${Math.abs(i - (n - 1) / 2) * 6}px)`;
</script>

<!-- clip sideways only, so cards flying in mid-animation never add a horizontal scrollbar on phones -->
<div bind:this={tableEl} class="overflow-x-clip">
	<Felt count={view.players.length}>
		{#snippet seat(k)}
			{@const p = seatAt(k)}
			<Seat
				player={p}
				isTurn={p.id === view.turnPlayerId || p.id === view.winnerId}
				isHost={p.id === view.hostId}
				isMe={p.id === room.playerId}
				timeLeft={p.id === view.turnPlayerId && msLeft !== null ? msLeft / TURN_MS : null}
				drain={p.id === view.turnPlayerId ? drain : null}
			/>
		{/snippet}

		{#if view.phase === 'finished'}
			<WinCascade />
			<div class="relative flex flex-col items-center gap-3 text-center">
				<p class="label" in:fly={{ y: 10, duration: prefersReducedMotion.current ? 0 : 300, delay: 200 }}>
					{iWon ? 'You win' : room.me ? 'You lost this one' : 'Winner'}
				</p>
				<p
					class="winner font-display text-4xl font-black text-brass sm:text-5xl"
					class:still={prefersReducedMotion.current}
				>
					{nameOf(view.winnerId)}
				</p>
				{#if room.isHost}
					<button class="btn-brass mt-2" onclick={room.reset} disabled={room.busy}>Shuffle &amp; play again</button>
				{:else}
					<p class="text-sm text-paper/75">Waiting for the host to open a new table…</p>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
				<TotalGauge total={view.total} limit={view.limit} direction={view.direction} />
				<div class="flex items-end gap-5">
					<div class="flex flex-col items-center gap-1" aria-label="{view.deckCount} cards left in the deck">
						<div class="relative h-[4.5rem] w-12">
							<span class="card-back absolute inset-0 translate-x-1 translate-y-1"></span>
							<span class="card-back absolute inset-0 translate-x-0.5 translate-y-0.5"></span>
							<span class="card-back absolute inset-0"></span>
						</div>
						<span class="text-xs text-paper/75">Deck {view.deckCount}</span>
					</div>
					<div class="grid h-[6.75rem] w-[4.75rem] place-items-center rounded-lg border border-dashed border-paper/40">
						{#each under as u (u.id)}
							<div class="col-start-1 row-start-1" style="rotate: {tiltOf(u.id)}deg" aria-hidden="true">
								<PlayingCard card={u.card} />
							</div>
						{/each}
						{#key view.topCard?.id}
							{#if view.topCard}
								<div
									class="col-start-1 row-start-1"
									data-pile-top
									in:placeCard|global={{ from: flightFrom(view.topCard.id), tilt: flightTilt(view.topCard.id) }}
								>
									<div style="rotate: {tiltOf(view.topCard.id)}deg"><PlayingCard card={view.topCard} /></div>
								</div>
							{/if}
						{/key}
					</div>
				</div>
			</div>
		{/if}
		{#if bust}
			{#key bust.moves}
				<BustStamp card={bust.card} total={bust.total} playerId={bust.playerId} eliminated={bust.eliminated} />
			{/key}
		{/if}
	</Felt>
</div>

<p class="mx-auto mt-4 mb-4 min-h-6 max-w-md text-center font-display text-base text-paper/80 italic" aria-live="polite">
	{dealerLine}
</p>

{#if view.phase === 'playing'}
	{#if room.me && room.me.lives > 0}
		<section aria-label="Your hand" class="flex flex-col items-center gap-4">
			<p class="text-sm font-semibold {room.myTurn ? 'text-brass' : 'text-paper/75'}" aria-live="polite">
				{room.myTurn ? 'Your turn. Pick a card.' : `Waiting for ${nameOf(view.turnPlayerId)}`}
			</p>
			<!-- The countdown itself is the ring on the seat; screen readers get one warning instead. -->
			{#if room.myTurn && secondsLeft !== null && secondsLeft <= 5}
				<p class="sr-only" role="alert">Time is almost up.</p>
			{/if}
			<div class="flex justify-center px-4 pt-2">
				{#each room.hand as card, i (card.id)}
					<div
						class="-mx-1.5 sm:mx-0.5 {placing?.id === card.id ? 'invisible' : ''}"
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
