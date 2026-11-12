<script lang="ts">
	/**
	 * The dealer's spot at the head of the table: the deck sits here and every deal starts from it.
	 * Games with a turn order pass `direction`, shown as a badge above the deck.
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
	class="relative flex w-24 flex-col items-center gap-1 text-center sm:w-28"
	aria-label={deckCount === null ? 'Dealer' : `Dealer, ${deckCount} cards in the deck`}
>
	{#if direction !== null}
		<p
			class="absolute bottom-full left-1/2 mb-1.5 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[11px] whitespace-nowrap text-paper/85"
			aria-live="polite"
		>
			<span class="direction" class:ccw={direction === -1} aria-hidden="true">↻</span>
			{direction === 1 ? 'Clockwise' : 'Counter-clockwise'}
		</p>
	{/if}
	<div class="relative h-12 w-9 sm:h-14 sm:w-10" data-deck aria-hidden="true">
		<span class="card-back absolute inset-0 translate-x-1 translate-y-1"></span>
		<span class="card-back absolute inset-0 translate-x-0.5 translate-y-0.5"></span>
		<span class="card-back absolute inset-0"></span>
	</div>
	<div class="rounded-sm bg-brass px-2 py-0.5 text-xs font-semibold text-ink">Dealer</div>
	{#if deckCount !== null}<div class="text-[11px] text-paper/75 tabular-nums">
			Deck {deckCount}
		</div>{/if}
</div>

<style>
	.direction {
		display: inline-block;
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
