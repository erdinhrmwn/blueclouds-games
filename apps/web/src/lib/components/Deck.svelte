<script lang="ts">
	/**
	 * The deck, face down in the middle of the table: the dealer deals from it and draws come off it. The table's card
	 * back comes from its `table-back-*` utility; the count sits under the stack.
	 */
	let { count }: { count: number } = $props();
</script>

<div class="flex flex-col items-center gap-1.5" role="img" aria-label="{count} cards in the deck">
	<div
		class="shoe relative h-[3.55rem] w-10 wide:h-[4.6rem] wide:w-[3.25rem]"
		data-deck
		aria-hidden="true"
	>
		<span class="card-back absolute inset-0 translate-x-1 translate-y-1"></span>
		<span class="card-back absolute inset-0 translate-x-0.5 translate-y-0.5"></span>
		<span class="card-back absolute inset-0"></span>
	</div>
	<span
		class="text-[11px] whitespace-nowrap text-paper/70 tabular-nums wide:text-xs"
		aria-hidden="true">{count} left</span
	>
</div>

<style>
	.shoe {
		filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
	}
</style>
