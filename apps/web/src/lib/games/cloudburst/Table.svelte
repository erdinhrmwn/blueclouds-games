<script lang="ts">
	import Dealer from '#lib/components/Dealer.svelte';
	import DealerLine from '#lib/components/DealerLine.svelte';
	import Felt from '#lib/components/Felt.svelte';
	import Seat from '#lib/components/Seat.svelte';
	import HandBar from '#lib/components/HandBar.svelte';
	import WinCascade from '#lib/components/WinCascade.svelte';
	import { dealCards, placeCard, seatRect, shake, whenDealt } from '#lib/motion.ts';
	import {
		type Card,
		DEAL,
		fits,
		HAND_SIZE,
		MAX_PLAYERS,
		type Suit,
		SUITS
	} from 'server/games/cloudburst/rules';
	import { prefersReducedMotion } from 'svelte/motion';
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import CloudCard from './CloudCard.svelte';
	import type { CloudburstConnection } from './connection.svelte.ts';
	import SuitGlyph from './SuitGlyph.svelte';
	import SuitPicker from './SuitPicker.svelte';
	import { SUIT_NAME, SUIT_TEXT } from './suits.ts';

	let { room }: { room: CloudburstConnection } = $props();

	/** Phones get a smaller pile so the middle of the table stays clear of the seats. */
	const wide = new MediaQuery('min-width: 640px');
	const pileSize = $derived(wide.current ? 'md' : 'sm');

	const view = $derived(room.view!);
	const inSeat = (seat: number) => view.players.find((p) => p.seat === seat) ?? null;
	const nameOf = (id: string | null | undefined) =>
		view.players.find((p) => p.id === id)?.name ?? '?';

	// Your hand, sorted by suit, then numbers before actions; Rainbows last.
	const ORDER = { number: 0, calm: 1, swirl: 2, gust: 3, rainbow: 4 } as const;
	/** Rainbows have no suit and sort after every suit. */
	const NO_SUIT_RANK = 9;
	const suitRank = (card: Card) => (card.suit ? SUITS.indexOf(card.suit) : NO_SUIT_RANK);

	const hand = $derived(
		[...room.hand.cards].sort(
			(a, b) => suitRank(a) - suitRank(b) || ORDER[a.kind] - ORDER[b.kind] || a.value - b.value
		)
	);

	let dealing = $state(false);
	/** While dealing: how many of your cards have landed in your hand so far. */
	let dealtCount = $state(HAND_SIZE);
	const canMove = $derived(room.myTurn && !room.busy && !dealing);

	/** After drawing, only the drawn card may be played. */
	const playable = (card: Card) => {
		if (!view.topCard || !fits(card, view.topCard, view.suit)) return false;
		return !view.drew || card.id === room.hand.drawnId;
	};

	/** The player after you, in the current direction. */
	const next = $derived.by(() => {
		const mine = view.players.findIndex((p) => p.id === room.playerId);
		const count = view.players.length;
		const index = (((mine + view.direction) % count) + count) % count;

		return view.players[index] ?? null;
	});

	// A Gust or Rainbow needs a second pick before anything is sent.
	let pending = $state<{ card: Card; needs: 'give' | 'suit' } | null>(null);
	$effect(() => {
		if (!room.myTurn) pending = null;
	});

	const barLabel = $derived.by(() => {
		if (!room.myTurn) {
			return `${nameOf(view.turnPlayerId)}’s turn`;
		}

		if (pending?.needs === 'give') {
			return `Give a card to ${next?.name}`;
		}

		if (pending?.needs === 'suit') {
			return `Pick a suit for ${next?.name}`;
		}

		return 'Your turn';
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

		if (card.kind === 'rainbow') {
			pending = { card, needs: 'suit' };
		} else if (card.kind === 'gust' && hand.length > 1) {
			pending = { card, needs: 'give' };
		} else {
			send(card);
		}
	}

	/** Who played the top card: the player, or whoever went out with it. */
	const lastPlayer = $derived.by(() => {
		const event = view.lastEvent;
		if (event?.type === 'played') return event.playerId;
		if (event?.type === 'roundEnd') return event.outId;
		return null;
	});

	const flightFrom = (id: string) => (placing?.id === id ? placing.rect : seatRect(lastPlayer));

	/** A cloud-meter segment: filled, filled and close to bursting, or empty. */
	const segmentClass = (index: number, points: number) => {
		if (index >= points) return 'bg-paper/20';
		return points >= view.burstAt - 2 ? 'bg-ember' : 'bg-paper/85';
	};

	/** A steady tilt of -6..6 degrees per card, from a hash of its id. */
	const tiltOf = (id: string) => {
		const hash = [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7);
		return (hash % 13) - 6;
	};

	// Round end: each seat's leftover cards fan open face up over it, then drip one by one into its
	// cloud meter, filling a segment as each lands. A seat that reaches the burst limit shakes once.
	// Done well inside DEAL.roundEndMs, before the next deal.
	const REVEAL = {
		fanMs: 250,
		holdMs: 700,
		spreadMs: 1800,
		stepMs: 180,
		fallMs: 380,
		clearMs: 3600
	};
	const BURST_SHAKE_MS = 900;
	const SKIPPED_BADGE_MS = 1600;
	/** How long a played card keeps its own flight start after it left your hand. */
	const PLACING_CLEAR_MS = 500;
	const DRAW_FLIGHT_MS = 450;
	const GIVE_FLIGHT_MS = 550;
	const CLOCK_TICK_MS = 250;

	/** Width of an `xs` card, and of the whole fan so it stays inside a phone seat. */
	const FAN = { cardPx: 28, maxPx: 88, stepPx: 14 };
	const overlap = (count: number) => {
		const step = Math.min(FAN.stepPx, (FAN.maxPx - FAN.cardPx) / Math.max(1, count - 1));
		return FAN.cardPx - step;
	};

	/**
	 * Your hand fans out to fit its row: each card shows as much as fits, up to the full overlap look, but never less
	 * than 44px to tap. A hand too long for that scrolls sideways. Card widths match CloudCard's `lg`.
	 */
	const HAND = {
		phone: { cardPx: 64, mostShownPx: 44, paddingPx: 16 },
		wide: { cardPx: 88, mostShownPx: 60, paddingPx: 32 },
		leastShownPx: 44
	};
	let handWidth = $state(0);
	const handOverlap = $derived.by(() => {
		const size = wide.current ? HAND.wide : HAND.phone;
		const space = handWidth - size.paddingPx - size.cardPx;
		const fits = hand.length > 1 ? Math.floor(space / (hand.length - 1)) : size.mostShownPx;
		const shown = Math.max(HAND.leastShownPx, Math.min(size.mostShownPx, fits));

		return size.cardPx - shown;
	});

	let reveal = $state<{
		moves: number;
		left: Record<string, Card[]>;
		landed: Record<string, number>;
	} | null>(null);
	let bursting = $state<string[]>([]);

	/** The points a seat's meter shows: during the reveal, the old total plus the drops landed so far. */
	const shownPoints = (player: (typeof view.players)[number]) => {
		if (!reveal) return player.points;

		const stillToLand = reveal.left[player.id]?.length ?? 0;
		const landed = reveal.landed[player.id] ?? 0;
		return player.points - stillToLand + landed;
	};

	function land(playerId: string) {
		if (!reveal) return;

		const landed = (reveal.landed[playerId] ?? 0) + 1;
		reveal.landed[playerId] = landed;

		// Shake the seat once its last card landed and it reached the burst limit.
		const player = view.players.find((p) => p.id === playerId);
		if (!player) return;
		if (landed < (reveal.left[playerId]?.length ?? 0)) return;
		if (player.points < view.burstAt) return;

		const seat = document.querySelector<HTMLElement>(`[data-seat="${CSS.escape(playerId)}"]`);
		shake(seat ?? undefined);

		bursting = [...bursting, playerId];
		setTimeout(() => {
			bursting = bursting.filter((id) => id !== playerId);
		}, BURST_SHAKE_MS);
	}

	/** One revealed card: fans out from the seat, waits, then falls into its meter segment. */
	function drip(
		node: HTMLElement,
		{ playerId, i, n, from }: { playerId: string; i: number; n: number; from: number }
	) {
		const meter = node.closest('[data-meter]');
		const segmentIndex = Math.min(from + i, view.burstAt - 1);
		const segment = meter?.querySelector(`[data-seg="${segmentIndex}"]`) ?? meter;
		if (!segment) return;

		const start = node.getBoundingClientRect();
		const end = segment.getBoundingClientRect();
		const dx = end.left + end.width / 2 - (start.left + start.width / 2);
		const dy = end.top + end.height / 2 - (start.top + start.height / 2);

		const fallAt = REVEAL.holdMs + i * Math.min(REVEAL.stepMs, REVEAL.spreadMs / n);
		const total = fallAt + REVEAL.fallMs;
		const spread = (i - (n - 1) / 2) * 6;

		const frames = [
			{
				offset: 0,
				transform: `translateX(${-spread}px) scale(0.6)`,
				opacity: 0,
				easing: 'ease-out'
			},
			{ offset: REVEAL.fanMs / total, transform: 'none', opacity: 1 },
			{
				offset: fallAt / total,
				transform: 'none',
				opacity: 1,
				easing: 'cubic-bezier(0.55, 0, 0.9, 0.45)'
			},
			{ offset: 1, transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0 }
		];

		const anim = node.animate(frames, { duration: total, fill: 'both' });
		anim.onfinish = () => land(playerId);

		return { destroy: () => anim.cancel() };
	}

	// Table events, each handled once (by `moves`): deals, draws, gusts, skips and the round summary.
	type RoundEnd = Extract<NonNullable<typeof view.lastEvent>, { type: 'roundEnd' }>;
	let skipped = $state<string | null>(null);
	let summary = $state<RoundEnd | null>(null);
	let handled = -1;

	$effect(() => {
		const event = view.lastEvent;
		if (view.moves === handled || !event) return;
		handled = view.moves;

		const still = prefersReducedMotion.current;
		const deck = () => document.querySelector('[data-deck]')?.getBoundingClientRect() ?? null;

		if (event.type === 'roundEnd') {
			summary = event;
			if (event.next === 'round') {
				setTimeout(() => {
					summary = null;
				}, DEAL.roundEndMs);
			}
		}

		const newRound = event.type === 'dealt' || event.type === 'roundEnd';
		if (view.phase === 'playing' && newRound) {
			const wait = event.type === 'roundEnd' ? DEAL.roundEndMs : 0;
			const seats = view.players.map((p) => p.id);
			const dealMs = seats.length * HAND_SIZE * DEAL.stepMs + DEAL.flightMs;

			dealing = true;
			dealtCount = still ? HAND_SIZE : 0;
			setTimeout(() => {
				dealCards(deck(), seats.map(seatRect), { passes: HAND_SIZE, ...DEAL });
			}, wait);

			if (!still) {
				const mine = seats.indexOf(room.playerId ?? '');
				whenDealt(mine, seats.length, { passes: HAND_SIZE, ...DEAL }, wait, (count) => {
					dealtCount = count;
				});
			}

			setTimeout(() => {
				dealing = false;
			}, wait + dealMs);
		}

		if (still) return;

		if (event.type === 'roundEnd' && event.left) {
			const moves = view.moves;
			reveal = { moves, left: event.left, landed: {} };
			setTimeout(() => {
				if (reveal?.moves === moves) reveal = null;
			}, REVEAL.clearMs);
		}

		if (event.type === 'drew' && event.got) {
			dealCards(deck(), [seatRect(event.playerId)], {
				passes: 1,
				stepMs: 0,
				flightMs: DRAW_FLIGHT_MS
			});
		}

		if (event.type === 'played' && event.gaveTo) {
			dealCards(seatRect(event.playerId), [seatRect(event.gaveTo)], {
				passes: 1,
				stepMs: 0,
				flightMs: GIVE_FLIGHT_MS
			});
		}

		if (event.type === 'played' && event.skipped) {
			const id = event.skipped;
			skipped = id;
			setTimeout(() => {
				if (skipped === id) skipped = null;
			}, SKIPPED_BADGE_MS);
		}
	});

	$effect(() => {
		if (!placing) return;

		const stillInHand = room.hand.cards.some((card) => card.id === placing!.id);
		if (stillInHand) return;

		const id = placing.id;
		setTimeout(() => {
			if (placing?.id === id) placing = null;
		}, PLACING_CLEAR_MS);
	});

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
	const drain = $derived.by(() => {
		if (room.turnEndsAt === null) return null;
		return { ms: Math.max(0, room.turnEndsAt - Date.now()), total: room.turnTotal };
	});

	/** "Sun 7", "Rain Gust", or "a Rainbow". */
	function cardName(card: Card): string {
		if (card.kind === 'rainbow') return 'a Rainbow';

		const face =
			card.kind === 'number'
				? String(card.value)
				: card.kind[0]!.toUpperCase() + card.kind.slice(1);
		return `${SUIT_NAME[card.suit!]} ${face}`;
	}

	const dealerLine = $derived.by(() => {
		const event = view.lastEvent;
		if (!event) return '';

		const auto = 'auto' in event && event.auto ? ' (time ran out)' : '';

		switch (event.type) {
			case 'joined':
				return `${nameOf(event.playerId)} sat down.`;
			case 'dealt':
				return `Round ${event.round}. Seven cards each.`;
			case 'played': {
				const nextSuit = event.card.kind === 'rainbow' ? `, ${SUIT_NAME[view.suit]} next` : '';
				const skip = event.skipped ? `. ${nameOf(event.skipped)} is skipped` : '';
				const gift = event.gaveTo ? ` and handed ${nameOf(event.gaveTo)} a card` : '';
				return `${nameOf(event.playerId)} played ${cardName(event.card)}${nextSuit}${skip}${gift}${auto}.`;
			}
			case 'drew':
				if (!event.got) return `The deck is empty. ${nameOf(event.playerId)} can only pass.`;
				return `${nameOf(event.playerId)} drew a card${auto}.`;
			case 'passed':
				return `${nameOf(event.playerId)} passed${auto}.`;
			case 'roundEnd': {
				const tie = event.tie ? ' Tie for fewest points: one more round.' : '';
				return `${nameOf(event.outId)} went out.${tie}`;
			}
		}
	});

	const standings = $derived([...view.players].sort((a, b) => a.points - b.points));
	const iWon = $derived(view.winnerId !== null && view.winnerId === room.playerId);

	function onKey(event: KeyboardEvent) {
		const typing = event.target instanceof HTMLInputElement;
		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === 'Escape' && pending) pending = null;
		if (!canMove || pending) return;

		if (event.key === 'd' && !view.drew) room.draw();
		if (event.key === 'p' && view.drew) room.pass();
	}

	// Left and right arrows move along your hand.
	function arrows(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

		const handEl = event.currentTarget as HTMLElement;
		const cards = [...handEl.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
		const current = cards.indexOf(document.activeElement as HTMLButtonElement);
		const step = event.key === 'ArrowRight' ? 1 : -1;

		cards[(current + step + cards.length) % cards.length]?.focus();
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- clip sideways only, so cards flying in mid-animation never add a horizontal scrollbar on phones -->
<div class="overflow-x-clip">
	<Felt count={MAX_PLAYERS + 1}>
		{#snippet seat(k)}
			{#if k === 0}
				<Dealer deckCount={view.deckCount} direction={view.direction} />
			{:else}
				{@const p = inSeat(k - 1)}
				{#snippet status()}
					{#if p}
						{@const shown = shownPoints(p)}
						{@const left = reveal?.left[p.id] ?? []}
						{@const cards = reveal ? left.length - (reveal.landed[p.id] ?? 0) : p.cards}
						<span class="flex flex-col items-center gap-0.5">
							<span
								class="text-[11px] tabular-nums {cards === 1
									? 'font-semibold text-ember'
									: 'text-paper/80'}"
							>
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
									<span data-seg={i} class="h-1.5 w-1 rounded-[1px] {segmentClass(i, shown)}"
									></span>
								{/each}
								<span class="ml-1 text-[10px] text-paper/75 tabular-nums">{shown}</span>
								{#if left.length}
									<!-- The hand left at the end of the round, face up; each card drips into the meter. -->
									<span
										class="pointer-events-none absolute bottom-full left-1/2 mb-11 flex -translate-x-1/2"
										aria-hidden="true"
									>
										{#each left as card, i (i)}
											<span
												class="shrink-0"
												style={i ? `margin-left: -${overlap(left.length)}px` : ''}
												use:drip={{
													playerId: p.id,
													i,
													n: left.length,
													from: p.points - left.length
												}}
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
					timeLeft={p && p.id === view.turnPlayerId && msLeft !== null
						? Math.min(1, msLeft / room.turnTotal)
						: null}
					drain={p && p.id === view.turnPlayerId ? drain : null}
				/>
			{/if}
		{/snippet}

		{#if view.phase === 'finished'}
			<WinCascade />
			<div class="relative flex flex-col items-center gap-1 text-center sm:gap-2">
				<p
					class="label"
					in:fly={{ y: 10, duration: prefersReducedMotion.current ? 0 : 300, delay: 200 }}
				>
					{iWon ? 'You win' : room.me ? 'You lost this one' : 'Winner'}
				</p>
				<p
					class="winner font-display text-3xl font-black text-brass sm:text-5xl"
					class:still={prefersReducedMotion.current}
				>
					{nameOf(view.winnerId)}
				</p>
				<!-- Two columns on phones, so six players still fit inside the felt. -->
				<ol
					class="mt-1 grid grid-cols-2 gap-x-4 text-xs tabular-nums sm:block sm:text-sm"
					aria-label="Final points"
				>
					{#each standings as p (p.id)}
						<li class={p.id === view.winnerId ? 'text-brass' : 'text-paper/80'}>
							{p.name}: {p.points}
						</li>
					{/each}
				</ol>
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
		{:else if summary}
			<div
				class="relative flex flex-col items-center gap-1.5 rounded-lg bg-black/60 px-3 py-3 text-center sm:gap-2 sm:px-5 sm:py-4"
				role="status"
			>
				<p class="font-display text-lg leading-tight font-bold sm:text-xl">
					{nameOf(summary.outId)} went out
				</p>
				<ul class="text-xs tabular-nums sm:text-sm">
					{#each standings as p (p.id)}
						<li class={p.points >= view.burstAt - 2 ? 'text-ember' : 'text-paper/85'}>
							{p.name}: +{summary.gained[p.id] ?? 0}, {p.points} of {view.burstAt}
						</li>
					{/each}
				</ul>
				{#if summary.tie}<p class="text-xs text-brass">
						Tie for fewest points: one more round.
					</p>{/if}
			</div>
		{:else}
			<!-- The pile sits dead centre; the suit badge hangs below it, clear of a tilted card's corners. -->
			<div class="relative">
				<div class="grid h-[4.6rem] w-[3.25rem] place-items-center sm:h-[6.75rem] sm:w-[4.75rem]">
					{#each view.pileUnder as u (u.id)}
						<div
							class="col-start-1 row-start-1"
							style="rotate: {tiltOf(u.id)}deg"
							aria-hidden="true"
						>
							<CloudCard card={u} size={pileSize} />
						</div>
					{/each}
					{#key view.topCard?.id}
						{#if view.topCard}
							<div
								class="col-start-1 row-start-1"
								in:placeCard|global={{ from: flightFrom(view.topCard.id), tilt: -20 }}
							>
								<div style="rotate: {tiltOf(view.topCard.id)}deg">
									<CloudCard card={view.topCard} size={pileSize} />
								</div>
							</div>
						{/if}
					{/key}
				</div>
				<div class="absolute top-full left-1/2 mt-4 -translate-x-1/2 sm:mt-5">
					<p
						class="suit-ring flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-1 text-xs font-semibold whitespace-nowrap sm:px-3 sm:text-sm {SUIT_TEXT[
							view.suit
						]}"
						aria-live="polite"
					>
						<SuitGlyph suit={view.suit} class="size-4" />{SUIT_NAME[view.suit]} to follow
					</p>
				</div>
			</div>
		{/if}
	</Felt>
</div>

<DealerLine text={dealerLine} moveKey={view.moves} />

{#if view.phase === 'playing' && room.me}
	<section aria-label="Your hand" class="flex flex-col items-center gap-3">
		<HandBar active={room.myTurn} label={barLabel} {secondsLeft}>
			{#snippet actions()}
				{#if pending}
					<button class="link-btn" onclick={() => (pending = null)}>Cancel</button>
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
		</HandBar>

		<SuitPicker
			open={pending?.needs === 'suit'}
			nextName={next?.name ?? ''}
			{secondsLeft}
			onpick={(suit) => send(pending!.card, { suit })}
			oncancel={() => (pending = null)}
		/>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- On a phone the row runs edge to edge, past the page gutter, so a full hand of seven fits. -->
		<div
			class="hand -mx-4 flex w-[calc(100%+2rem)] justify-center-safe overflow-x-auto px-2 pt-4 pb-2 sm:mx-0 sm:w-full sm:px-4"
			class:pointer-events-none={dealing}
			bind:clientWidth={handWidth}
			onkeydown={arrows}
		>
			{#each hand as card, index (card.id)}
				{@const giving = pending?.needs === 'give'}
				{@const isPending = pending?.card.id === card.id}
				{@const landed = !dealing || index < dealtCount}
				<div
					class="shrink-0 {dealing && landed ? 'dealt-in' : ''}"
					class:invisible={placing?.id === card.id || !landed}
					style={index ? `margin-left: -${handOverlap}px` : ''}
					data-card={card.id}
				>
					<CloudCard
						{card}
						size="lg"
						fits={room.myTurn && (giving ? !isPending : playable(card))}
						selected={isPending || (card.id === room.hand.drawnId && view.drew)}
						disabled={!canMove || (giving ? isPending : !playable(card))}
						label={giving ? 'Give' : 'Play'}
						onplay={() => choose(card)}
					/>
				</div>
			{/each}
		</div>
	</section>
{/if}

<style>
	.hand {
		scrollbar-width: thin;
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
		.suit-ring {
			transition: none;
		}
	}
</style>
