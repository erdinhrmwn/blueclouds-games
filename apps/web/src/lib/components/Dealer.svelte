<script lang="ts">
	/** The dealer's spot at the head of the table: the deck sits here and every deal starts from it. */
	let { deckCount = null }: { deckCount?: number | null } = $props();
</script>

<div class="flex w-24 flex-col items-center gap-1 text-center sm:w-28" aria-label={deckCount === null ? 'Dealer' : `Dealer, ${deckCount} cards in the deck`}>
	<div class="relative h-12 w-9 sm:h-14 sm:w-10" data-deck aria-hidden="true">
		<span class="card-back absolute inset-0 translate-x-1 translate-y-1"></span>
		<span class="card-back absolute inset-0 translate-x-0.5 translate-y-0.5"></span>
		<span class="card-back absolute inset-0"></span>
	</div>
	<div class="rounded-sm bg-brass px-2 py-0.5 text-xs font-semibold text-ink">Dealer</div>
	{#if deckCount !== null}<div class="text-[11px] text-paper/75 tabular-nums">Deck {deckCount}</div>{/if}
</div>
