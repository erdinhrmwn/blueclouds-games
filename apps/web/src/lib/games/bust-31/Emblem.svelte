<script lang="ts">
	import EmblemTile, { arc } from '#lib/components/EmblemTile.svelte';
	import { LIMIT } from 'server/games/bust-31/rules';

	/** Bust 31's emblem: the oxblood back with a 0–31 gauge (red zone at the end) round the 31. */
	let {
		small = false,
		label,
		class: cls
	}: { small?: boolean; label?: string; class?: string } = $props();

	const START = 135;
	const SWEEP = 270;
	const RED_FROM = 25;
	const RED_GAP = 4;
	const redAngle = START + (SWEEP * RED_FROM) / LIMIT;
</script>

<EmblemTile back="#5e1a1f" deep="#3f1014" pattern="dots" {small} {label} class={cls}>
	{#snippet motif(size: number)}
		{@const radius = size * 0.42}
		{@const weight = size * 0.075}
		<path
			d={arc(radius, START, START + SWEEP)}
			fill="none"
			stroke="var(--color-paper)"
			stroke-opacity="0.18"
			stroke-width={weight}
			stroke-linecap="round"
		/>
		<path
			d={arc(radius, START, redAngle - RED_GAP)}
			fill="none"
			stroke="var(--color-brass)"
			stroke-width={weight}
			stroke-linecap="round"
		/>
		<path
			d={arc(radius, redAngle, START + SWEEP)}
			fill="none"
			stroke="var(--color-ember)"
			stroke-width={weight}
			stroke-linecap="round"
		/>
		<text
			x="50"
			y={50 + size * 0.16}
			text-anchor="middle"
			font-family="var(--font-display)"
			font-weight="900"
			font-size={size * 0.44}
			fill="var(--color-paper)">{LIMIT}</text
		>
	{/snippet}
</EmblemTile>
