<script lang="ts">
	import { type Card, SUITS, type Suit } from 'server/games/cloudburst/rules';
	import type { Snippet } from 'svelte';
	import SuitGlyph from './SuitGlyph.svelte';
	import { SUIT_NAME } from './suits.ts';

	/**
	 * Cloudburst's centre: a weather ring round the pile, one quarter per suit, the suit to follow lit; and beside it
	 * what may be played next: that suit, or the card one step either side, or the same action.
	 */
	let { suit, top, children }: { suit: Suit; top: Card | null; children: Snippet } = $props();

	/** Each suit's quarter of the ring, clockwise from the top: Sun north, Rain east, Wind south, Storm west. */
	const QUARTER: Record<Suit, number> = { sun: 0, rain: 1, wind: 2, storm: 3 };
	/** Where each suit's mark sits on the ring. */
	const POINT: Record<Suit, string> = {
		sun: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
		rain: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2',
		wind: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
		storm: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2'
	};
	/** The suits' ink is made for the cream card; on the felt the ring uses a lighter tint of it. */
	const TINT: Record<Suit, string> = {
		sun: 'var(--color-sun-light)',
		rain: 'var(--color-rain-light)',
		wind: 'var(--color-wind-light)',
		storm: 'var(--color-storm-light)'
	};
	const LIT: Record<Suit, string> = {
		sun: 'bg-sun',
		rain: 'bg-rain',
		wind: 'bg-wind',
		storm: 'bg-storm'
	};
	const ACTION: Record<string, string> = {
		calm: 'Calm',
		swirl: 'Swirl',
		gust: 'Gust',
		downpour: 'Downpour'
	};
	const LOWEST = 1;
	const HIGHEST = 8;

	/** Ring geometry in the SVG's own units: a 100 × 100 box, quarters split by small gaps. */
	const RADIUS = 44;
	const GAP_DEGREES = 14;

	/** The arc of one quarter, centred on its compass point. */
	function arc(quarter: number): string {
		const centre = quarter * 90 - 90;
		const from = ((centre - 45 + GAP_DEGREES / 2) * Math.PI) / 180;
		const to = ((centre + 45 - GAP_DEGREES / 2) * Math.PI) / 180;
		const start = [50 + RADIUS * Math.cos(from), 50 + RADIUS * Math.sin(from)];
		const end = [50 + RADIUS * Math.cos(to), 50 + RADIUS * Math.sin(to)];

		return `M${start[0]} ${start[1]} A${RADIUS} ${RADIUS} 0 0 1 ${end[0]} ${end[1]}`;
	}

	/** What else fits besides the suit: the numbers either side, the same action, or nothing after a wild card. */
	const also = $derived.by(() => {
		if (!top || top.suit === null) {
			return null;
		}

		if (top.kind !== 'number') {
			return `or any ${ACTION[top.kind]}`;
		}

		const steps = [top.value - 1, top.value + 1].filter((v) => v >= LOWEST && v <= HIGHEST);
		return `or any ${steps.join(' or ')}`;
	});
</script>

<!-- Two siblings, the ring and the hint, so the table lays them out beside or under each other. -->
<div class="relative grid size-32 place-items-center wide:size-44">
	<svg class="absolute inset-0 size-full" viewBox="0 0 100 100" fill="none" aria-hidden="true">
		<circle cx="50" cy="50" r="38" fill="rgb(0 0 0 / 0.22)" />
		{#each SUITS as point (point)}
			{@const lit = point === suit}
			<path
				d={arc(QUARTER[point])}
				stroke={TINT[point]}
				stroke-width={lit ? 5 : 2.5}
				stroke-linecap="round"
				class="quarter"
				opacity={lit ? 1 : 0.3}
			/>
		{/each}
	</svg>
	{#each SUITS as point (point)}
		{@const lit = point === suit}
		<span
			class="absolute grid place-items-center rounded-full {POINT[point]} {lit
				? `size-8 text-paper wide:size-10 ${LIT[point]} lit`
				: 'size-5 bg-panel text-paper/60 ring-1 ring-paper/15 wide:size-6'}"
			aria-hidden="true"
		>
			<SuitGlyph suit={point} class={lit ? 'size-4 wide:size-5' : 'size-3 wide:size-3.5'} />
		</span>
	{/each}
	{@render children()}
</div>
<div class="text-center wide:text-left" aria-live="polite">
	<p class="text-[11px] font-medium text-paper/60 wide:text-xs">Follow</p>
	<p class="font-display text-xl leading-tight font-bold text-paper wide:text-3xl">
		<span class="sr-only">Play </span>{SUIT_NAME[suit]}
	</p>
	{#if also}
		<p class="text-xs text-paper/75 wide:text-sm">{also}</p>
	{/if}
</div>

<style>
	.lit {
		box-shadow:
			0 0 0 2px var(--color-paper),
			0 4px 10px rgb(0 0 0 / 0.4);
	}
	.quarter {
		transition:
			opacity 400ms ease,
			stroke-width 400ms ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.quarter {
			transition: none;
		}
	}
</style>
