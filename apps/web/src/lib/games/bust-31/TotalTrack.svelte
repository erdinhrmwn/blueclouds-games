<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';

	/**
	 * Bust 31's total, the heart of the game, as the table's centrepiece: the number itself, big, over a row of one pip
	 * per point up to the limit. Brass fills the pips up to the total; the last stretch before the limit is the danger
	 * zone, outlined in ember, and the number turns ember once the total is in it.
	 */
	let { total, limit }: { total: number; limit: number } = $props();

	/** Points within this distance of the limit count as danger. */
	const DANGER = 6;

	const shown = $derived(Math.max(total, 0));
	const danger = $derived(shown > limit - DANGER);
	const left = $derived(limit - total);
	const leftText = $derived(left >= 0 ? `${left} to bust` : 'bust');

	/** A pip: filled up to the total, ember from the danger zone on. */
	const pipClass = (point: number) => {
		const inDanger = point > limit - DANGER;
		if (point <= shown) {
			return inDanger ? 'bg-ember' : 'bg-brass';
		}

		return inDanger ? 'ring-1 ring-ember/70 ring-inset' : 'bg-paper/15';
	};
</script>

<div
	class="flex flex-col items-center"
	role="meter"
	aria-valuemin="0"
	aria-valuemax={limit}
	aria-valuenow={total}
	aria-label="Total {total} of {limit}, {leftText}"
>
	<p class="flex items-baseline gap-1 font-display leading-none" aria-hidden="true">
		{#key shown}
			<span
				class="total text-[3.5rem] font-black tabular-nums wide:text-[5.5rem] {danger
					? 'text-ember'
					: 'text-paper'}"
				class:pop={!prefersReducedMotion.current}>{shown}</span
			>
		{/key}
		<span class="text-sm font-bold text-paper/45 wide:text-lg">/{limit}</span>
	</p>
	<div class="mt-2 flex gap-[1.5px] wide:mt-3 wide:gap-[2px]" aria-hidden="true">
		{#each Array(limit) as _, i (i)}
			<span class="h-2 w-[3px] rounded-[1px] wide:h-3 wide:w-1 {pipClass(i + 1)}"></span>
		{/each}
	</div>
	<p
		class="mt-1.5 text-[11px] font-medium tabular-nums wide:mt-2 wide:text-[13px] {danger
			? 'text-ember'
			: 'text-paper/65'}"
		aria-hidden="true"
	>
		{leftText}
	</p>
</div>

<style>
	.total {
		text-shadow: 0 3px 10px rgb(0 0 0 / 0.45);
	}
	/* A new total lands with a small bump, so a change catches the eye. */
	.pop {
		animation: pop 320ms cubic-bezier(0.3, 0.7, 0.3, 1.4);
	}
	@keyframes pop {
		from {
			transform: scale(0.8);
			opacity: 0.4;
		}
	}
</style>
