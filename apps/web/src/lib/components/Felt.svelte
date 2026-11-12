<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * U-shaped card table: spot 0 (the dealer) sits at the middle of the flat top edge,
	 * the other `count - 1` spots follow the U clockwise, from the top of the right arm round to the left one.
	 */
	let { count, seat, children }: { count: number; seat: Snippet<[number]>; children: Snippet } =
		$props();

	/** Where the arms of the U start, and where its bottom curve starts, as % of the table's height. */
	const ARM_TOP = 14;
	// Keep in sync with `.u` below.
	const CURVE_TOP = 35;
	const STEPS = 90;

	let width = $state(0);
	let height = $state(0);

	/** The chairs' path in % of the table: down the right arm, round the bottom half-ellipse, up the left arm. */
	const path: [number, number][] = [
		[100, ARM_TOP],
		...Array.from({ length: STEPS + 1 }, (_, i): [number, number] => {
			const angle = (i * Math.PI) / STEPS;
			const x = 50 + 50 * Math.cos(angle);
			const y = CURVE_TOP + (100 - CURVE_TOP) * Math.sin(angle);
			return [x, y];
		}),
		[0, ARM_TOP]
	];

	/** Chairs spaced evenly by on-screen distance along the path, so a tall phone table doesn't bunch them. */
	const chairs = $derived.by(() => {
		// `along[i]`: on-screen distance from the start of the path to point i.
		const along = [0];
		for (let i = 1; i < path.length; i++) {
			const [x0, y0] = path[i - 1];
			const [x1, y1] = path[i];
			const dx = ((x1 - x0) * (width || 1)) / 100;
			const dy = ((y1 - y0) * (height || 1)) / 100;
			along.push(along[i - 1] + Math.hypot(dx, dy));
		}

		const total = along[along.length - 1];
		const chairCount = count - 1;

		return Array.from({ length: chairCount }, (_, chair) => {
			// One chair alone sits in the middle; more are spread from end to end.
			const target = chairCount > 1 ? (chair / (chairCount - 1)) * total : total / 2;

			// Interpolate between the two path points around that distance.
			const i = Math.max(
				1,
				along.findIndex((distance) => distance >= target)
			);
			const t = (target - along[i - 1]) / (along[i] - along[i - 1] || 1);
			const [x0, y0] = path[i - 1];
			const [x1, y1] = path[i];

			return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
		});
	});

	function position(k: number) {
		const [x, y] = k === 0 ? [50, 0] : chairs[k - 1];
		return `left: ${x}%; top: ${y}%;`;
	}
</script>

<!-- Phones get a taller top gutter so the badge above the dealer clears the room header. -->
<div
	class="relative mx-auto aspect-[3/4] w-full max-w-3xl px-10 pt-20 pb-14 sm:aspect-[16/10] sm:px-16 sm:py-16"
>
	<div class="table-rim u relative h-full w-full p-3 sm:p-4">
		<div class="felt u relative grid h-full w-full place-items-center">
			{@render children()}
		</div>
	</div>
	<div
		class="pointer-events-none absolute inset-x-12 top-20 bottom-14 sm:inset-x-16 sm:inset-y-16"
		bind:clientWidth={width}
		bind:clientHeight={height}
	>
		{#each Array(count) as _, k (k)}
			<div
				class="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
				style={position(k)}
			>
				{@render seat(k)}
			</div>
		{/each}
	</div>
</div>

<style>
	/* Flat top edge for the dealer, straight arms, then a half-ellipse along the bottom (65% = 100 - CURVE_TOP). */
	.u {
		border-radius: 1.5rem 1.5rem 50% 50% / 1.5rem 1.5rem 65% 65%;
	}
	.table-rim {
		background: linear-gradient(160deg, var(--color-rim-light), var(--color-rim) 45%, #2e1c10);
		box-shadow:
			0 30px 60px rgb(0 0 0 / 0.6),
			inset 0 2px 0 rgb(255 255 255 / 0.12),
			inset 0 -3px 6px rgb(0 0 0 / 0.4);
	}
	.felt {
		background:
			radial-gradient(ellipse at 50% 40%, rgb(255 255 255 / 0.07), transparent 60%),
			radial-gradient(ellipse at center, var(--color-felt) 0%, var(--color-felt-deep) 100%);
		box-shadow:
			inset 0 0 0 2px rgb(210 165 76 / 0.25),
			inset 0 0 40px rgb(0 0 0 / 0.55);
	}
</style>
