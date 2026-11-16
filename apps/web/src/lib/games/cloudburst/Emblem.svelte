<script lang="ts">
	import EmblemTile, { CLOUD, cloudAt } from '#lib/components/EmblemTile.svelte';

	/** Cloudburst's emblem: the deep blue back with a cloud dropping one drop per suit. */
	let {
		small = false,
		label,
		class: cls
	}: { small?: boolean; label?: string; class?: string } = $props();

	const DROP = 'M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11Z';
	const DROP_GRID = 24;
	const SUIT_COLOURS = [
		'var(--color-sun-light)',
		'var(--color-rain-light)',
		'var(--color-wind-light)',
		'var(--color-storm-light)'
	];
</script>

<EmblemTile back="#1f3f5f" deep="#142a40" pattern="clouds" {small} {label} class={cls}>
	{#snippet motif(size: number)}
		<path d={CLOUD} transform={cloudAt(50, 50 - size * 0.1, size * 0.8)} fill="#b7d2ec" />
		{#each SUIT_COLOURS as colour, index (colour)}
			{@const scale = (size * 0.19) / DROP_GRID}
			{@const x = 50 + (index - 1.5) * size * 0.19 - 12 * scale}
			{@const y = 50 + size * 0.17 + (index % 2) * size * 0.07 - 3 * scale}
			<path d={DROP} transform="translate({x} {y}) scale({scale})" fill={colour} />
		{/each}
	{/snippet}
</EmblemTile>
