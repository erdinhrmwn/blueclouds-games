<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { scale } from 'svelte/transition';

	let { total, limit, direction }: { total: number; limit: number; direction: 1 | -1 } = $props();

	// A 270° dial open at the bottom, like a pressure gauge set into the table.
	const SWEEP = 270;
	const R = 47;
	/** Points within this distance of the limit count as danger. */
	const DANGER = 5;

	const angleOf = (v: number) => -SWEEP / 2 + (SWEEP * v) / limit;
	// Angle 0 points up, positive goes clockwise.
	const at = (deg: number, r: number) => {
		const rad = (deg * Math.PI) / 180;
		return { x: 60 + r * Math.sin(rad), y: 60 - r * Math.cos(rad) };
	};
	const arc = (from: number, to: number, r: number) => {
		const a = at(angleOf(from), r);
		const b = at(angleOf(to), r);
		const large = angleOf(to) - angleOf(from) > 180 ? 1 : 0;
		return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
	};

	const ticks = $derived(
		Array.from({ length: limit + 1 }, (_, v) => {
			const major = v % 5 === 0 || v === limit;
			return { v, inner: at(angleOf(v), major ? 36.5 : 38.5), outer: at(angleOf(v), 41), danger: v > limit - DANGER };
		})
	);
	const ratio = $derived(Math.min(Math.max(total, 0) / limit, 1));
	const left = $derived(limit - total);
	// calm → warning → about to bust
	const tone = $derived(
		left < DANGER ? 'var(--color-ember)' : left < DANGER * 2 + 2 ? 'var(--color-brass)' : 'var(--color-paper)'
	);
	const leftText = $derived(left >= 0 ? `${left} left` : 'bust');
</script>

<div class="flex flex-col items-center gap-1.5">
	<div
		class="relative size-32 sm:size-36"
		role="meter"
		aria-valuemin="0"
		aria-valuemax={limit}
		aria-valuenow={total}
		aria-label="Total {total} of {limit}, {leftText}"
	>
		<svg viewBox="0 0 120 120" class="size-full" aria-hidden="true">
			<!-- brass bezel and the dark dial face -->
			<circle cx="60" cy="60" r="57" fill="rgb(0 0 0 / 0.38)" stroke="var(--color-brass-dim)" stroke-width="1.5" />
			<circle cx="60" cy="60" r="54" fill="none" stroke="rgb(0 0 0 / 0.35)" stroke-width="1" />
			<path d={arc(0, limit, R)} fill="none" stroke="rgb(243 234 214 / 0.1)" stroke-width="5" stroke-linecap="round" />
			<path d={arc(limit - DANGER, limit, R)} fill="none" stroke="var(--color-ember)" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round" />
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
				stroke-dasharray="{ratio * 100} 100"
				opacity={total > 0 ? 1 : 0}
				style="transition: stroke-dasharray 400ms ease, stroke 400ms ease"
			/>
		</svg>
		<div class="absolute inset-0 flex flex-col items-center justify-center pb-2">
			{#key total}
				<!-- The number pops on every change so a move is felt even when looking at the hand. -->
				<span
					class="font-display text-5xl leading-none font-black tabular-nums"
					style="color: {tone}"
					in:scale={{ start: 1.5, duration: prefersReducedMotion.current ? 0 : 260 }}>{total}</span
				>
			{/key}
			<span class="mt-0.5 text-xs text-paper/70">of {limit}</span>
		</div>
		<!-- sits in the open bottom of the dial -->
		<span class="absolute inset-x-0 bottom-[7%] text-center text-xs font-semibold tabular-nums" style="color: {tone}">{leftText}</span>
	</div>
	<span class="text-xs text-paper/75" aria-label="Turn order {direction === 1 ? 'clockwise' : 'counterclockwise'}">
		{direction === 1 ? '↻ Clockwise' : '↺ Reversed'}
	</span>
</div>
