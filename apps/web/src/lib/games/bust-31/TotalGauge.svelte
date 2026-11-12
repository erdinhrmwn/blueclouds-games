<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion, Spring } from 'svelte/motion';
	import { scale } from 'svelte/transition';

	let { total, limit }: { total: number; limit: number } = $props();

	// A 270° dial open at the bottom, like a pressure gauge set into the table.
	const SWEEP = 270;
	const R = 47;
	/** Points within this distance of the limit count as danger. */
	const DANGER = 5;

	const angleOf = (value: number) => -SWEEP / 2 + (SWEEP * value) / limit;
	// Angle 0 points up, positive goes clockwise.
	const at = (deg: number, r: number) => {
		const rad = (deg * Math.PI) / 180;
		return { x: 60 + r * Math.sin(rad), y: 60 - r * Math.cos(rad) };
	};
	const arc = (from: number, to: number, r: number) => {
		const start = at(angleOf(from), r);
		const end = at(angleOf(to), r);
		// SVG's large-arc flag: 1 when the arc spans more than half a circle.
		const large = angleOf(to) - angleOf(from) > 180 ? 1 : 0;

		return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
	};

	const ticks = $derived(
		Array.from({ length: limit + 1 }, (_, v) => {
			const major = v % 5 === 0 || v === limit;
			return {
				v,
				inner: at(angleOf(v), major ? 36.5 : 38.5),
				outer: at(angleOf(v), 41),
				danger: v > limit - DANGER
			};
		})
	);
	const ratio = $derived(Math.min(Math.max(total, 0) / limit, 1));

	// The filled arc swings to the new total like a needle, overshooting a touch before it settles.
	const fill = new Spring(
		untrack(() => ratio),
		{ stiffness: 0.2, damping: 0.5, precision: 0.001 }
	);

	$effect(() => {
		fill.set(ratio, { instant: prefersReducedMotion.current });
	});

	// A swing below zero would give the stroke a negative dash, which SVG rejects.
	const fillLength = $derived(Math.max(0, fill.current) * 100);

	const left = $derived(limit - total);
	// calm → warning → about to bust
	const tone = $derived.by(() => {
		if (left < DANGER) return 'var(--color-ember)';
		if (left < DANGER * 2 + 2) return 'var(--color-brass)';
		return 'var(--color-paper)';
	});
	const leftText = $derived(left >= 0 ? `${left} left` : 'bust');
</script>

<div
	class="relative size-28 sm:size-36"
	role="meter"
	aria-valuemin="0"
	aria-valuemax={limit}
	aria-valuenow={total}
	aria-label="Total {total} of {limit}, {leftText}"
>
	<svg viewBox="0 0 120 120" class="size-full" aria-hidden="true">
		<!-- brass bezel and the dark dial face -->
		<circle
			cx="60"
			cy="60"
			r="57"
			fill="rgb(0 0 0 / 0.38)"
			stroke="var(--color-brass-dim)"
			stroke-width="1.5"
		/>
		<circle cx="60" cy="60" r="54" fill="none" stroke="rgb(0 0 0 / 0.35)" stroke-width="1" />
		<path
			d={arc(0, limit, R)}
			fill="none"
			stroke="rgb(243 234 214 / 0.1)"
			stroke-width="5"
			stroke-linecap="round"
		/>
		<path
			d={arc(limit - DANGER, limit, R)}
			fill="none"
			stroke="var(--color-ember)"
			stroke-opacity="0.35"
			stroke-width="5"
			stroke-linecap="round"
		/>
		{#each ticks as t (t.v)}
			<line
				x1={t.inner.x}
				y1={t.inner.y}
				x2={t.outer.x}
				y2={t.outer.y}
				stroke={t.danger ? 'var(--color-ember)' : 'var(--color-paper)'}
				stroke-opacity={t.v <= total ? 0.9 : 0.3}
				stroke-width="1"
				stroke-linecap="round"
			/>
		{/each}
		<path
			d={arc(0, limit, R)}
			fill="none"
			stroke={tone}
			stroke-width="5"
			stroke-linecap="round"
			pathLength="100"
			stroke-dasharray="{fillLength} 100"
			opacity={total > 0 ? 1 : 0}
			style="transition: stroke 400ms ease"
		/>
	</svg>
	<div class="absolute inset-0 flex flex-col items-center justify-center pb-2">
		{#key total}
			<!-- The number pops on every change so a move is felt even when looking at the hand. -->
			<span
				class="font-display text-4xl leading-none sm:text-5xl font-black tabular-nums"
				style="color: {tone}"
				in:scale={{ start: 1.5, duration: prefersReducedMotion.current ? 0 : 260 }}>{total}</span
			>
		{/key}
		<span class="mt-0.5 text-xs text-paper/70">of {limit}</span>
	</div>
	<!-- sits in the open bottom of the dial -->
	<span
		class="absolute inset-x-0 bottom-[7%] text-center text-xs font-semibold tabular-nums"
		style="color: {tone}">{leftText}</span
	>
</div>
