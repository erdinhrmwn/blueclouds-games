<script lang="ts" module>
	/** A cloud on a 64 grid, 56.5 wide and centred on (31.2, 29.6). Motifs place it with `cloudAt`. */
	export const CLOUD =
		'M15 46 A10 10 0 0 1 12.6 27.4 A15 15 0 0 1 40.5 20.5 A12.5 12.5 0 0 1 51 46 Z';

	/** The transform that draws CLOUD centred on (cx, cy), `width` wide. */
	export function cloudAt(cx: number, cy: number, width: number) {
		const scale = width / 56.5;

		return `translate(${cx - 31.2 * scale} ${cy - 29.6 * scale}) scale(${scale})`;
	}

	/** An SVG arc around (50, 50), angles in degrees clockwise from 3 o'clock. */
	export function arc(radius: number, start: number, end: number) {
		const toPoint = (angle: number) => {
			const rad = (angle * Math.PI) / 180;

			return `${50 + radius * Math.cos(rad)} ${50 + radius * Math.sin(rad)}`;
		};

		const large = end - start > 180 ? 1 : 0;

		return `M${toPoint(start)} A${radius} ${radius} 0 ${large} 1 ${toPoint(end)}`;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A game's emblem (FigCraft page "Brand · Game logos"): a tile cut from the game's card back with one
	 * motif in a brass ring. A new game brings its back colour, pattern and motif. `small` is the under-48px
	 * drawing: no pattern or ring, a bigger motif. The motif is drawn around (50, 50) at the diameter given.
	 */
	let {
		back,
		deep,
		pattern,
		small = false,
		label,
		class: cls = 'size-12',
		motif
	}: {
		back: string;
		deep: string;
		pattern: 'dots' | 'clouds';
		small?: boolean;
		/** The game's name for screen readers; leave it out where the name is printed beside the emblem. */
		label?: string;
		class?: string;
		motif: Snippet<[number]>;
	} = $props();

	const STEP = 11;
	const MARGIN = 12;
	const COUNT = 8;
	const RING_MOTIF = 52.7;
	const SMALL_MOTIF = 78;

	// The back's pattern on a staggered grid, kept inside the tile's rounded edge.
	const spots = Array.from({ length: COUNT * COUNT }, (_, index) => {
		const row = Math.floor(index / COUNT);
		const col = index % COUNT;
		const shift = row % 2 === 1 ? STEP / 2 : 0;

		return { x: MARGIN + col * STEP + shift, y: MARGIN + row * STEP };
	}).filter((spot) => spot.x <= 100 - MARGIN && spot.y <= 100 - MARGIN);
</script>

<svg
	viewBox="0 0 100 100"
	class={cls}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<rect width="100" height="100" rx="22" fill={back} />
	{#if small}
		{@render motif(SMALL_MOTIF)}
	{:else}
		{#each spots as spot (`${spot.x}-${spot.y}`)}
			{#if pattern === 'dots'}
				<circle cx={spot.x} cy={spot.y} r="1.3" fill="var(--color-paper)" fill-opacity="0.13" />
			{:else}
				<path
					d={CLOUD}
					transform={cloudAt(spot.x, spot.y, 7)}
					fill="var(--color-paper)"
					fill-opacity="0.1"
				/>
			{/if}
		{/each}
		<rect
			x="5"
			y="5"
			width="90"
			height="90"
			rx="18"
			fill="none"
			stroke="var(--color-paper)"
			stroke-opacity="0.22"
			stroke-width="1.2"
		/>
		<circle cx="50" cy="50" r="34" fill={deep} stroke="var(--color-brass)" stroke-width="3" />
		{@render motif(RING_MOTIF)}
	{/if}
</svg>
