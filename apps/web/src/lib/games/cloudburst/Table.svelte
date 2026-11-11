<script lang="ts">
	import Dealer from '#lib/components/Dealer.svelte';
	import Felt from '#lib/components/Felt.svelte';
	import Seat from '#lib/components/Seat.svelte';
	import WinCascade from '#lib/components/WinCascade.svelte';
	import { dealCards, placeCard, seatRect, shake } from '#lib/motion.ts';
	import { type Card, DEAL, fits, HAND_SIZE, MAX_PLAYERS, type Suit, SUITS } from 'server/games/cloudburst/rules';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import CloudCard from './CloudCard.svelte';
	import type { CloudburstConnection } from './connection.svelte.ts';
	import SuitGlyph from './SuitGlyph.svelte';
	import { SUIT_NAME, SUIT_TEXT } from './suits.ts';

	let { room }: { room: CloudburstConnection } = $props();
	const view = $derived(room.view!);
	const inSeat = (s: number) => view.players.find((p) => p.seat === s) ?? null;
	const nameOf = (id: string | null | undefined) => view.players.find((p) => p.id === id)?.name ?? '?';

	// Your hand, sorted by suit, then numbers before actions; Rainbows last.
	const ORDER = { number: 0, calm: 1, swirl: 2, gust: 3, rainbow: 4 } as const;
	const hand = $derived(
		[...room.hand.cards].sort(
			(a, b) => (a.suit ? SUITS.indexOf(a.suit) : 9) - (b.suit ? SUITS.indexOf(b.suit) : 9) || ORDER[a.kind] - ORDER[b.kind] || a.value - b.value
		)
	);
	let dealing = $state(false);
	const canMove = $derived(room.myTurn && !room.busy && !dealing);
	const playable = (c: Card) => !!view.topCard && fits(c, view.topCard, view.suit) && (!view.drew || c.id === room.hand.drawnId);
	const next = $derived.by(() => {
		const i = view.players.findIndex((p) => p.id === room.playerId);
		const n = view.players.length;
		return view.players[(((i + view.direction) % n) + n) % n] ?? null;
	});

	// A Gust or Rainbow needs a second pick before anything is sent.
	let pending = $state<{ card: Card; needs: 'give' | 'suit' } | null>(null);
	$effect(() => {
		if (!room.myTurn) pending = null;
	});

	// Your own card flies from where it sat in your hand, so remember that spot on click.
	let placing = $state.raw<{ id: string; rect: DOMRect } | null>(null);
	function send(card: Card, extra: { suit?: Suit; giveId?: string } = {}) {
		const el = document.querySelector(`[data-card="${CSS.escape(card.id)}"]`);
		if (el) placing = { id: card.id, rect: el.getBoundingClientRect() };
		pending = null;
		room.play({ cardId: card.id, ...extra }).then(() => {
			if (room.error) placing = null;
		});
	}
	function choose(card: Card) {
		if (pending?.needs === 'give') return send(pending.card, { giveId: card.id });
		if (!playable(card)) return;
		if (card.kind === 'rainbow') pending = { card, needs: 'suit' };
		else if (card.kind === 'gust' && hand.length > 1) pending = { card, needs: 'give' };
		else send(card);
	}
	const lastPlayer = $derived(view.lastEvent?.type === 'played' || view.lastEvent?.type === 'roundEnd' ? (view.lastEvent.type === 'played' ? view.lastEvent.playerId : view.lastEvent.outId) : null);
	const flightFrom = (id: string) => (placing?.id === id ? placing.rect : seatRect(lastPlayer));
	const tiltOf = (id: string) => ([...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) % 13) - 6;

	// Round end: each seat's leftover cards fan open face up over it, then drip one by one into its
	// cloud meter, filling a segment as each lands. A seat that reaches the burst limit shakes once.
	// Done well inside DEAL.roundEndMs, before the next deal.
	const REVEAL = { fanMs: 250, holdMs: 700, spreadMs: 1800, stepMs: 180, fallMs: 380, clearMs: 3600 };
	/** Width of an `xs` card, and of the whole fan so it stays inside a phone seat. */
	const FAN = { cardPx: 28, maxPx: 88, stepPx: 14 };
	const overlap = (n: number) => FAN.cardPx - Math.min(FAN.stepPx, (FAN.maxPx - FAN.cardPx) / Math.max(1, n - 1));
	let reveal = $state<{ moves: number; left: Record<string, Card[]>; landed: Record<string, number> } | null>(null);
	let bursting = $state<string[]>([]);
	/** The points a seat's meter shows: during the reveal, the old total plus the drops landed so far. */
	const shownPoints = (p: (typeof view.players)[number]) =>
		reveal ? p.points - (reveal.left[p.id]?.length ?? 0) + (reveal.landed[p.id] ?? 0) : p.points;

	function land(playerId: string) {
		if (!reveal) return;
		const landed = (reveal.landed[playerId] ?? 0) + 1;
		reveal.landed[playerId] = landed;
		const p = view.players.find((q) => q.id === playerId);
		if (!p || landed < (reveal.left[playerId]?.length ?? 0) || p.points < view.burstAt) return;
		shake(document.querySelector<HTMLElement>(`[data-seat="${CSS.escape(playerId)}"]`) ?? undefined);
		bursting = [...bursting, playerId];
		setTimeout(() => (bursting = bursting.filter((id) => id !== playerId)), 900);
	}

	/** One revealed card: fans out from the seat, waits, then falls into its meter segment. */
	function drip(node: HTMLElement, { playerId, i, n, from }: { playerId: string; i: number; n: number; from: number }) {
		const meter = node.closest('[data-meter]');
		const seg = meter?.querySelector(`[data-seg="${Math.min(from + i, view.burstAt - 1)}"]`) ?? meter;
		if (!seg) return;
		const a = node.getBoundingClientRect();
		const b = seg.getBoundingClientRect();
		const dx = b.left + b.width / 2 - (a.left + a.width / 2);
		const dy = b.top + b.height / 2 - (a.top + a.height / 2);
		const fallAt = REVEAL.holdMs + i * Math.min(REVEAL.stepMs, REVEAL.spreadMs / n);
		const total = fallAt + REVEAL.fallMs;
		const spread = (i - (n - 1) / 2) * 6;
		const anim = node.animate(
			[
				{ offset: 0, transform: `translateX(${-spread}px) scale(0.6)`, opacity: 0, easing: 'ease-out' },
				{ offset: REVEAL.fanMs / total, transform: 'none', opacity: 1 },
				{ offset: fallAt / total, transform: 'none', opacity: 1, easing: 'cubic-bezier(0.55, 0, 0.9, 0.45)' },
				{ offset: 1, transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0 }
			],
			{ duration: total, fill: 'both' }
		);
		anim.onfinish = () => land(playerId);
		return { destroy: () => anim.cancel() };
	}

	// Table events, each handled once (by `moves`): deals, draws, gusts, skips and the round summary.
	let skipped = $state<string | null>(null);
	let summary = $state<Extract<NonNullable<typeof view.lastEvent>, { type: 'roundEnd' }> | null>(null);
	let handled = -1;
	$effect(() => {
		const e = view.lastEvent;
		if (view.moves === handled || !e) return;
		handled = view.moves;
		const still = prefersReducedMotion.current;
		const deck = () => document.querySelector('[data-deck]')?.getBoundingClientRect() ?? null;
		if (e.type === 'roundEnd') {
			summary = e;
			if (e.next === 'round') setTimeout(() => (summary = null), DEAL.roundEndMs);
		}
		if (view.phase === 'playing' && (e.type === 'dealt' || e.type === 'roundEnd')) {
			const wait = e.type === 'roundEnd' ? DEAL.roundEndMs : 0;
			const seats = view.players.map((p) => p.id);
			dealing = true;
			setTimeout(() => dealCards(deck(), seats.map(seatRect), { passes: HAND_SIZE, ...DEAL }), wait);
			setTimeout(() => (dealing = false), wait + seats.length * HAND_SIZE * DEAL.stepMs + DEAL.flightMs);
		}
		if (still) return;
		if (e.type === 'roundEnd' && e.left) {
			const moves = view.moves;
			reveal = { moves, left: e.left, landed: {} };
			setTimeout(() => reveal?.moves === moves && (reveal = null), REVEAL.clearMs);
		}
		if (e.type === 'drew' && e.got) dealCards(deck(), [seatRect(e.playerId)], { passes: 1, stepMs: 0, flightMs: 450 });
		if (e.type === 'played' && e.gaveTo) dealCards(seatRect(e.playerId), [seatRect(e.gaveTo)], { passes: 1, stepMs: 0, flightMs: 550 });
		if (e.type === 'played' && e.skipped) {
			const id = e.skipped;
			skipped = id;
			setTimeout(() => skipped === id && (skipped = null), 1600);
		}
	});
	$effect(() => {
		if (placing && !room.hand.cards.some((c) => c.id === placing!.id)) {
			const id = placing.id;
			setTimeout(() => placing?.id === id && (placing = null), 500);
		}
	});

	// Ticks while a turn timer runs; the deadline itself comes from the server.
	let now = $state(Date.now());
	$effect(() => {
		if (room.turnEndsAt === null) return;
		const id = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(id);
	});
	const msLeft = $derived(room.turnEndsAt === null ? null : Math.max(0, room.turnEndsAt - now));
	const secondsLeft = $derived(msLeft === null ? null : Math.ceil(msLeft / 1000));
	const drain = $derived(room.turnEndsAt === null ? null : { ms: Math.max(0, room.turnEndsAt - Date.now()), total: room.turnTotal });

	const cardName = (c: Card) =>
		c.kind === 'rainbow' ? 'a Rainbow' : `${SUIT_NAME[c.suit!]} ${c.kind === 'number' ? c.value : c.kind[0]!.toUpperCase() + c.kind.slice(1)}`;
	const dealerLine = $derived.by(() => {
		const e = view.lastEvent;
		if (!e) return '';
		const auto = 'auto' in e && e.auto ? ' (time ran out)' : '';
		switch (e.type) {
			case 'joined':
				return `${nameOf(e.playerId)} sat down.`;
			case 'dealt':
				return `Round ${e.round}. Seven cards each.`;
			case 'played':
				return `${nameOf(e.playerId)} played ${cardName(e.card)}${e.card.kind === 'rainbow' ? `, ${SUIT_NAME[view.suit]} next` : ''}${e.skipped ? `. ${nameOf(e.skipped)} is skipped` : ''}${e.gaveTo ? ` and handed ${nameOf(e.gaveTo)} a card` : ''}${auto}.`;
			case 'drew':
				return e.got ? `${nameOf(e.playerId)} drew a card${auto}.` : `The deck is empty. ${nameOf(e.playerId)} can only pass.`;
			case 'passed':
				return `${nameOf(e.playerId)} passed${auto}.`;
			case 'roundEnd':
				return `${nameOf(e.outId)} went out.${e.tie ? ' Tie for fewest points: one more round.' : ''}`;
		}
	});
	const standings = $derived([...view.players].sort((a, b) => a.points - b.points));
	const iWon = $derived(view.winnerId !== null && view.winnerId === room.playerId);

	function onKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'Escape' && pending) pending = null;
		if (!canMove || pending) return;
		if (e.key === 'd' && !view.drew) room.draw();
		if (e.key === 'p' && view.drew) room.pass();
	}
	// Left and right arrows move along your hand.
	function arrows(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
		const i = cards.indexOf(document.activeElement as HTMLButtonElement);
		cards[(i + (e.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length]?.focus();
		e.preventDefault();
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- clip sideways only, so cards flying in mid-animation never add a horizontal scrollbar on phones -->
<div class="overflow-x-clip">
	<Felt count={MAX_PLAYERS + 1}>
		{#snippet seat(k)}
			{#if k === 0}
				<Dealer deckCount={view.deckCount} />
			{:else}
				{@const p = inSeat(k - 1)}
				{#snippet status()}
					{#if p}
						{@const shown = shownPoints(p)}
						{@const left = reveal?.left[p.id] ?? []}
						{@const cards = reveal ? left.length - (reveal.landed[p.id] ?? 0) : p.cards}
						<span class="flex flex-col items-center gap-0.5">
							<span class="text-[11px] tabular-nums {cards === 1 ? 'font-semibold text-ember' : 'text-paper/80'}">
								{skipped === p.id ? 'Skipped' : cards === 1 ? '1 card' : `${cards} cards`}
							</span>
							<span
								class="relative flex items-center gap-px"
								class:burst={bursting.includes(p.id)}
								data-meter
								role="img"
								aria-label="{p.points} of {view.burstAt} points"
							>
								{#each Array(view.burstAt) as _, i (i)}
									<span
										data-seg={i}
										class="h-1.5 w-1 rounded-[1px] {i < shown ? (shown >= view.burstAt - 2 ? 'bg-ember' : 'bg-paper/85') : 'bg-paper/20'}"
									></span>
								{/each}
								<span class="ml-1 text-[10px] text-paper/75 tabular-nums">{shown}</span>
								{#if left.length}
									<!-- The hand left at the end of the round, face up; each card drips into the meter. -->
									<span class="pointer-events-none absolute bottom-full left-1/2 mb-11 flex -translate-x-1/2" aria-hidden="true">
										{#each left as card, i (i)}
											<span
												class="shrink-0"
												style={i ? `margin-left: -${overlap(left.length)}px` : ''}
												use:drip={{ playerId: p.id, i, n: left.length, from: p.points - left.length }}
											>
												<CloudCard {card} size="xs" />
											</span>
										{/each}
									</span>
								{/if}
							</span>
						</span>
					{/if}
				{/snippet}
				<Seat
					player={p}
					number={k}
					isTurn={!!p && (p.id === view.turnPlayerId || p.id === view.winnerId)}
					isHost={!!p && p.id === view.hostId}
					isMe={!!p && p.id === room.playerId}
					out={!!p && skipped === p.id}
					{status}
					timeLeft={p && p.id === view.turnPlayerId && msLeft !== null ? Math.min(1, msLeft / room.turnTotal) : null}
					drain={p && p.id === view.turnPlayerId ? drain : null}
				/>
			{/if}
		{/snippet}

		{#if view.phase === 'finished'}
			<WinCascade />
			<div class="relative flex flex-col items-center gap-1 text-center sm:gap-2">
				<p class="label" in:fly={{ y: 10, duration: prefersReducedMotion.current ? 0 : 300, delay: 200 }}>
					{iWon ? 'You win' : room.me ? 'You lost this one' : 'Winner'}
				</p>
				<p class="winner font-display text-3xl font-black text-brass sm:text-5xl" class:still={prefersReducedMotion.current}>
					{nameOf(view.winnerId)}
				</p>
				<!-- Two columns on phones, so six players still fit inside the felt. -->
				<ol class="mt-1 grid grid-cols-2 gap-x-4 text-xs tabular-nums sm:block sm:text-sm" aria-label="Final points">
					{#each standings as p (p.id)}
						<li class={p.id === view.winnerId ? 'text-brass' : 'text-paper/80'}>{p.name}: {p.points}</li>
					{/each}
				</ol>
				{#if view.tournament}
					<p class="text-sm text-paper/75">This {view.tournament.name} table is done.</p>
				{:else if room.isHost}
					<button class="btn-brass mt-2" onclick={room.reset} disabled={room.busy}>Shuffle &amp; play again</button>
				{:else}
					<p class="text-sm text-paper/75">Waiting for the host to open a new table…</p>
				{/if}
			</div>
		{:else if summary}
			<div class="relative flex flex-col items-center gap-1.5 rounded-lg bg-black/60 px-3 py-3 text-center sm:gap-2 sm:px-5 sm:py-4" role="status">
				<p class="font-display text-lg leading-tight font-bold sm:text-xl">{nameOf(summary.outId)} went out</p>
				<ul class="text-xs tabular-nums sm:text-sm">
					{#each standings as p (p.id)}
						<li class={p.points >= view.burstAt - 2 ? 'text-ember' : 'text-paper/85'}>
							{p.name}: +{summary.gained[p.id] ?? 0}, {p.points} of {view.burstAt}
						</li>
					{/each}
				</ul>
				{#if summary.tie}<p class="text-xs text-brass">Tie for fewest points: one more round.</p>{/if}
			</div>
		{:else}
			<div class="flex items-center gap-2 sm:gap-6">
				<div class="flex flex-col items-center gap-1 text-[11px] text-paper/75">
					<span class="direction text-2xl leading-none text-paper/80" class:ccw={view.direction === -1} aria-hidden="true">↻</span>
					<!-- Phones show only the arrow, so the pile stays clear of the side seats. -->
					<span class="sr-only sm:not-sr-only">{view.direction === 1 ? 'Clockwise' : 'Counter-clockwise'}</span>
				</div>
				<div class="flex flex-col items-center gap-2">
					<div class="grid h-[6.75rem] w-[4.75rem] place-items-center">
						{#each view.pileUnder as u (u.id)}
							<div class="col-start-1 row-start-1" style="rotate: {tiltOf(u.id)}deg" aria-hidden="true"><CloudCard card={u} /></div>
						{/each}
						{#key view.topCard?.id}
							{#if view.topCard}
								<div class="col-start-1 row-start-1" in:placeCard|global={{ from: flightFrom(view.topCard.id), tilt: -20 }}>
									<div style="rotate: {tiltOf(view.topCard.id)}deg"><CloudCard card={view.topCard} /></div>
								</div>
							{/if}
						{/key}
					</div>
					<p class="suit-ring flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-1 text-xs font-semibold whitespace-nowrap sm:px-3 sm:text-sm {SUIT_TEXT[view.suit]}" aria-live="polite">
						<SuitGlyph suit={view.suit} class="size-4" />{SUIT_NAME[view.suit]} to follow
					</p>
				</div>
			</div>
		{/if}
	</Felt>
</div>

<p class="mx-auto mt-4 mb-2 min-h-6 max-w-md text-center font-display text-base text-paper/80 italic" aria-live="polite">{dealerLine}</p>

{#if view.phase === 'playing' && room.me}
	<section aria-label="Your hand" class="flex flex-col items-center gap-3">
		<p class="text-sm font-semibold {room.myTurn ? 'text-brass' : 'text-paper/75'}" aria-live="polite">
			{#if pending?.needs === 'give'}
				Pick a card to give to {next?.name}
			{:else if pending?.needs === 'suit'}
				Pick the suit {next?.name} must follow
			{:else if room.myTurn}
				{view.drew ? 'Play the card you drew, or pass.' : 'Your turn. Play a card that fits, or draw.'}
			{:else}
				Waiting for {nameOf(view.turnPlayerId)}
			{/if}
		</p>
		{#if room.myTurn && secondsLeft !== null && secondsLeft <= 5}
			<p class="sr-only" role="alert">Time is almost up.</p>
		{/if}

		<!-- Right under the prompt, so on a phone the move is on screen before the hand is. -->
		{#if room.myTurn}
			<div class="flex items-center gap-3">
				{#if pending}
					<button class="btn-ghost" onclick={() => (pending = null)}>Cancel</button>
				{:else if view.drew}
					<button class="btn-brass" onclick={room.pass} disabled={!canMove}>Pass <span class="text-xs opacity-70">(P)</span></button>
				{:else}
					<button class="btn-ghost" onclick={room.draw} disabled={!canMove}>Draw a card <span class="text-xs opacity-70">(D)</span></button>
				{/if}
			</div>
		{/if}

		{#if pending?.needs === 'suit'}
			<div class="flex flex-wrap justify-center gap-2" role="group" aria-label="Pick a suit">
				{#each SUITS as s (s)}
					<button class="btn flex-col gap-0.5 bg-paper px-4 {SUIT_TEXT[s]}" onclick={() => send(pending!.card, { suit: s })}>
						<SuitGlyph suit={s} class="size-6" />{SUIT_NAME[s]}
					</button>
				{/each}
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="hand flex max-w-full justify-start overflow-x-auto px-4 pt-4 pb-2 transition-opacity duration-300 sm:justify-center {dealing ? 'pointer-events-none opacity-0' : ''}"
			onkeydown={arrows}
		>
			{#each hand as card (card.id)}
				{@const giving = pending?.needs === 'give'}
				{@const isPending = pending?.card.id === card.id}
				<div class="hand-card shrink-0 {placing?.id === card.id ? 'invisible' : ''}" data-card={card.id}>
					<CloudCard
						{card}
						size="lg"
						fits={giving ? !isPending : playable(card)}
						selected={isPending || (card.id === room.hand.drawnId && view.drew)}
						disabled={!canMove || (giving ? isPending : !playable(card))}
						label={giving ? 'Give' : 'Play'}
						onplay={() => choose(card)}
					/>
				</div>
			{/each}
		</div>

		{#if room.myTurn && secondsLeft !== null}<p class="text-xs text-paper/75">If time runs out, a move is made for you.</p>{/if}
	</section>
{/if}

<style>
	/* Overlap the hand, but always leave at least 44px of each card to tap. */
	.hand-card + .hand-card {
		margin-left: -1.6rem;
	}
	@media (min-width: 640px) {
		.hand-card + .hand-card {
			margin-left: -1.75rem;
		}
	}
	.hand {
		scrollbar-width: thin;
	}
	.direction {
		transition: transform 500ms cubic-bezier(0.3, 0.7, 0.3, 1.2);
	}
	.direction.ccw {
		transform: scaleX(-1);
	}
	.suit-ring {
		transition: color 400ms ease;
	}
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
	/* The meter that reached the limit flashes ember twice. */
	.burst {
		animation: flash 450ms ease-in-out 2;
	}
	@keyframes flash {
		50% {
			filter: brightness(1.5) drop-shadow(0 0 3px var(--color-ember));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.burst {
			animation: none;
		}
		.direction,
		.suit-ring {
			transition: none;
		}
	}
</style>
