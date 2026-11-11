<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { scale } from 'svelte/transition';

	let { total, limit, direction }: { total: number; limit: number; direction: 1 | -1 } = $props();

	const R = 44;
	const C = 2 * Math.PI * R;
	const ratio = $derived(Math.min(total / limit, 1));
	// calm → warning → about to bust
	const tone = $derived(total > limit - 5 ? 'var(--color-ember)' : total > limit - 12 ? 'var(--color-brass)' : 'var(--color-paper)');
</script>

<div class="relative size-28 sm:size-32" role="meter" aria-valuemin="0" aria-valuemax={limit} aria-valuenow={total} aria-label="Total {total} of limit {limit}">
	<svg viewBox="0 0 100 100" class="size-full -rotate-90">
		<circle cx="50" cy="50" r={R} fill="rgb(0 0 0 / 0.35)" stroke="rgb(243 234 214 / 0.12)" stroke-width="6" />
		<circle
			cx="50"
			cy="50"
			r={R}
			fill="none"
			stroke={tone}
			stroke-width="6"
			stroke-linecap="round"
			stroke-dasharray={C}
			stroke-dashoffset={C * (1 - ratio)}
			style="transition: stroke-dashoffset 400ms ease, stroke 400ms ease"
		/>
	</svg>
	<div class="absolute inset-0 flex flex-col items-center justify-center">
		{#key total}
			<!-- The number pops on every change so a move is felt even when looking at the hand. -->
			<span
				class="font-display text-4xl leading-none font-black tabular-nums sm:text-5xl"
				style="color: {tone}"
				in:scale={{ start: 1.5, duration: prefersReducedMotion.current ? 0 : 260 }}>{total}</span
			>
		{/key}
		<span class="mt-1 text-xs text-paper/75">of {limit}</span>
	</div>
	<span
		class="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] whitespace-nowrap text-paper/85"
		aria-label="Turn order {direction === 1 ? 'clockwise' : 'counterclockwise'}"
	>
		{direction === 1 ? '↻ clockwise' : '↺ reversed'}
	</span>
</div>
