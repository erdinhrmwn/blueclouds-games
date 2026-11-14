<script lang="ts">
	import Nimbus from './Nimbus.svelte';

	/**
	 * The dealer's spot at the head of the table: Nimbus in a brass-ringed pit cut into the rail,
	 * the shoe with the deck on its right, and (for games with a turn order) the direction on its left.
	 */
	let {
		deckCount = null,
		direction = null
	}: {
		deckCount?: number | null;
		direction?: 1 | -1 | null;
	} = $props();
</script>

<div
	class="relative flex flex-col items-center"
	aria-label={deckCount === null
		? 'Dealer Nimbus'
		: `Dealer Nimbus, ${deckCount} cards in the deck`}
>
	<div
		class="pit grid size-[4.25rem] place-items-center rounded-full wide:size-[5.75rem]"
		aria-hidden="true"
	>
		<Nimbus class="size-12 wide:size-16" />
	</div>
	<p
		class="-mt-2 rounded-[4px] bg-brass px-2 py-px font-display text-[10px] font-bold text-ink wide:text-[11px]"
		aria-hidden="true"
	>
		Nimbus
	</p>

	{#if deckCount !== null}
		<div class="absolute top-1/2 left-full ml-3 flex flex-col items-center gap-1 wide:ml-5">
			<div class="shoe relative h-11 w-8 wide:h-14 wide:w-10" data-deck aria-hidden="true">
				<span class="card-back absolute inset-0 translate-x-1 translate-y-1"></span>
				<span class="card-back absolute inset-0 translate-x-0.5 translate-y-0.5"></span>
				<span class="card-back absolute inset-0"></span>
			</div>
			<span class="text-[11px] whitespace-nowrap text-paper/70 tabular-nums">Deck {deckCount}</span>
		</div>
	{/if}

	{#if direction !== null}
		<p
			class="absolute top-1/2 right-full mr-3 flex items-center gap-1.5 rounded-full bg-black/40 px-1.5 py-1.5 wide:px-2.5 wide:py-1 text-[11px] whitespace-nowrap text-paper/85 wide:mr-5"
			aria-live="polite"
		>
			<span class="direction inline-flex" class:ccw={direction === -1} aria-hidden="true">
				<svg
					viewBox="0 0 20 20"
					class="size-3.5 text-brass"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M4 12a6 6 0 1 0 2-6m0 0H2.5m3.5 0V2.5" />
				</svg>
			</span>
			<span class="tall:sr-only">{direction === 1 ? 'Clockwise' : 'Counter-clockwise'}</span>
		</p>
	{/if}
</div>

<style>
	.pit {
		background: radial-gradient(circle at 50% 40%, #241b14, #14110e 70%);
		box-shadow:
			0 0 0 2px var(--color-brass),
			0 0 0 6px var(--color-room),
			0 8px 18px rgb(0 0 0 / 0.5);
	}
	.shoe {
		filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
	}
	.direction {
		transition: transform 500ms cubic-bezier(0.3, 0.7, 0.3, 1.2);
	}
	.direction.ccw {
		transform: scaleX(-1);
	}
	@media (prefers-reduced-motion: reduce) {
		.direction {
			transition: none;
		}
	}
</style>
