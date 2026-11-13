<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion, Spring } from 'svelte/motion';

	/**
	 * Bust 31's total as a slider from 0 to the limit: brass fills up to the total, the last stretch is the
	 * danger zone, and the total rides the end of the fill as the slider's thumb.
	 */
	let { total, limit }: { total: number; limit: number } = $props();

	/** Points within this distance of the limit count as danger. */
	const DANGER = 6;
	const TICK_STEP = 10;

	const ratio = $derived(Math.min(Math.max(total, 0) / limit, 1));

	// The thumb slides to the new total, overshooting a touch before it settles.
	const fill = new Spring(
		untrack(() => ratio),
		{ stiffness: 0.2, damping: 0.5, precision: 0.001 }
	);

	$effect(() => {
		fill.set(ratio, { instant: prefersReducedMotion.current });
	});

	const percent = $derived(Math.min(Math.max(fill.current, 0), 1) * 100);
	const left = $derived(limit - total);
	const leftText = $derived(left >= 0 ? `${left} to bust` : 'bust');

	/** Tick labels: every ten, and the limit itself; a ten too close to the limit (30 next to 31) is left out. */
	const MIN_TICK_GAP = TICK_STEP / 2;
	const ticks = $derived([
		...Array.from({ length: Math.floor(limit / TICK_STEP) + 1 }, (_, i) => i * TICK_STEP).filter(
			(value) => limit - value >= MIN_TICK_GAP
		),
		limit
	]);

	/** The note sits on the side away from the thumb, so they never meet. */
	const noteOnLeft = $derived(ratio > 0.5);
</script>

<div
	class="w-[9.5rem] sm:w-64"
	role="meter"
	aria-valuemin="0"
	aria-valuemax={limit}
	aria-valuenow={total}
	aria-label="Total {total} of {limit}, {leftText}"
>
	<p
		class="mb-2.5 text-[11px] text-paper/65 tabular-nums sm:text-xs {noteOnLeft
			? 'text-left'
			: 'text-right'}"
		aria-hidden="true"
	>
		{leftText}
	</p>
	<div class="relative h-2" aria-hidden="true">
		<div class="absolute inset-0 rounded-full bg-paper/12"></div>
		<div
			class="absolute inset-y-0 right-0 rounded-full bg-ember/70"
			style="width: {(DANGER / limit) * 100}%"
		></div>
		<div class="absolute inset-y-0 left-0 rounded-full bg-brass" style="width: {percent}%"></div>
		<span
			class="thumb absolute top-1/2 grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brass font-display text-[11px] font-black text-ink tabular-nums"
			style="left: {percent}%">{total}</span
		>
	</div>
	<div class="relative mt-3 h-4 text-[10px] text-paper/50 tabular-nums" aria-hidden="true">
		{#each ticks as value (value)}
			<span class="absolute -translate-x-1/2" style="left: {(value / limit) * 100}%">{value}</span>
		{/each}
	</div>
</div>

<style>
	.thumb {
		box-shadow:
			0 0 0 1.5px rgb(243 234 214 / 0.85),
			0 2px 4px rgb(0 0 0 / 0.4);
	}
</style>
