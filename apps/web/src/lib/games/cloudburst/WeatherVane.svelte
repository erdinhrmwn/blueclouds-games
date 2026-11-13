<script lang="ts">
	import { type Card, SUITS, type Suit } from 'server/games/cloudburst/rules';
	import type { Snippet } from 'svelte';
	import SuitGlyph from './SuitGlyph.svelte';
	import { SUIT_NAME } from './suits.ts';

	/**
	 * Cloudburst's centre: a weather vane round the pile. The four suits sit at its points, the one to
	 * follow lit, and under it what may be played next: that suit, or the card one step either side.
	 */
	let { suit, top, children }: { suit: Suit; top: Card | null; children: Snippet } = $props();

	/** Where each suit sits on the vane: Sun north, Rain east, Wind south, Storm west. */
	const POINT: Record<Suit, string> = {
		sun: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
		rain: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2',
		wind: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
		storm: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2'
	};
	const LIT: Record<Suit, string> = {
		sun: 'bg-sun',
		rain: 'bg-rain',
		wind: 'bg-wind',
		storm: 'bg-storm'
	};
	const ACTION: Record<string, string> = { calm: 'Calm', swirl: 'Swirl', gust: 'Gust' };
	const LOWEST = 1;
	const HIGHEST = 8;

	/** "Rain, 5 or 7", "Rain or Gust", or just "Rain" after a Rainbow. */
	const hint = $derived.by(() => {
		const name = SUIT_NAME[suit];
		if (!top || top.kind === 'rainbow') {
			return name;
		}
		if (top.kind !== 'number') {
			return `${name} or ${ACTION[top.kind]}`;
		}

		const steps = [top.value - 1, top.value + 1].filter((v) => v >= LOWEST && v <= HIGHEST);
		return `${name}, ${steps.join(' or ')}`;
	});
</script>

<div class="flex flex-col items-center gap-6 sm:gap-8">
	<div class="vane relative grid size-28 place-items-center rounded-full sm:size-[9.25rem]">
		{#each SUITS as point (point)}
			{@const lit = point === suit}
			<span
				class="absolute grid place-items-center rounded-full {POINT[point]} {lit
					? `size-7 text-paper sm:size-9 ${LIT[point]} lit`
					: 'size-5 bg-panel text-paper/70 ring-1 ring-paper/20 sm:size-6'}"
				aria-hidden="true"
			>
				<SuitGlyph suit={point} class={lit ? 'size-4 sm:size-5' : 'size-3 sm:size-3.5'} />
			</span>
		{/each}
		{@render children()}
	</div>
	<p
		class="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold whitespace-nowrap text-paper/90 sm:text-sm"
		aria-live="polite"
	>
		<span class="sr-only">Play </span>{hint}
	</p>
</div>

<style>
	.vane {
		background: rgb(0 0 0 / 0.28);
		box-shadow: inset 0 0 0 1px rgb(243 234 214 / 0.14);
	}
	.lit {
		box-shadow: 0 0 0 2px var(--color-paper);
	}
</style>
