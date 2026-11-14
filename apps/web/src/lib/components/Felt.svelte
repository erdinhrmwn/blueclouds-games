<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * U-shaped card table: spot 0 (the dealer) sits at the middle of the flat top edge,
	 * the other `count - 1` spots follow the U clockwise, from the top of the right arm round to the left one.
	 * `children` is the table's centre: it gets the felt's safe zone, which no chair or the dealer reaches.
	 */
	let {
		count,
		seat,
		children,
		name = '',
		direction = null
	}: {
		count: number;
		seat: Snippet<[number]>;
		children: Snippet;
		/** Printed faintly on the felt, like a casino table: the game's name. */
		name?: string;
		/** Chevrons on the rail, for games with a turn order: 1 clockwise, -1 counter-clockwise. */
		direction?: 1 | -1 | null;
	} = $props();

	/** Where the arms of the U start, and where its bottom curve starts, as % of the table's height. */
	const ARM_TOP = 16;
	// Keep in sync with `.u` below.
	const CURVE_TOP = 38;
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

	/** On-screen distance from the start of the path to each of its points. */
	const along = $derived.by(() => {
		const distances = [0];
		for (let i = 1; i < path.length; i++) {
			const [x0, y0] = path[i - 1];
			const [x1, y1] = path[i];
			const dx = ((x1 - x0) * (width || 1)) / 100;
			const dy = ((y1 - y0) * (height || 1)) / 100;
			distances.push(distances[i - 1] + Math.hypot(dx, dy));
		}

		return distances;
	});

	/** The point that far along the path (in % of the table), and the path's on-screen heading there in degrees. */
	function pointAt(target: number): { x: number; y: number; angle: number } {
		const i = Math.max(
			1,
			along.findIndex((distance) => distance >= target)
		);
		const t = (target - along[i - 1]) / (along[i] - along[i - 1] || 1);
		const [x0, y0] = path[i - 1];
		const [x1, y1] = path[i];
		const heading = Math.atan2(((y1 - y0) * height) / 100, ((x1 - x0) * width) / 100);

		return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle: (heading * 180) / Math.PI };
	}

	/** How far along the path chair `chair` sits: spaced evenly, so a tall phone table doesn't bunch them. */
	const chairAlong = (chair: number) => {
		const total = along[along.length - 1];
		const chairCount = count - 1;

		// One chair alone sits in the middle; more are spread from end to end.
		return chairCount > 1 ? (chair / (chairCount - 1)) * total : total / 2;
	};

	const chairs = $derived(
		Array.from({ length: count - 1 }, (_, chair) => pointAt(chairAlong(chair)))
	);

	/** The turn order: a small brass chevron on the rail halfway between each pair of neighbouring chairs. */
	const chevrons = $derived(
		Array.from({ length: Math.max(0, count - 2) }, (_, chair) =>
			pointAt((chairAlong(chair) + chairAlong(chair + 1)) / 2)
		)
	);

	function position(k: number) {
		const { x, y } = k === 0 ? { x: 50, y: 0 } : chairs[k - 1];
		return `left: ${x}%; top: ${y}%;`;
	}

	/**
	 * The dealer is centred on its spot. A chair is pinned by its avatar's centre (Seat's avatar is 48px on the tall
	 * stage and 56px on the wide one, so 24px or 28px down), with the name plate and any meter hanging below, so every
	 * avatar sits on the rail at the same height whatever is under it.
	 */
	const anchor = (k: number) =>
		k === 0 ? '-translate-y-1/2' : '-translate-y-6 wide:-translate-y-7';
</script>

<!-- The same size in every phase (lobby, play, finished), so the table never jumps: a fixed height on each stage, the
	 full width of the tall stage and a 2.15:1 table on the wide one. Whatever goes under it (your hand, the invite, the
	 result button) shares the rest of the stage.
	 The top gutter holds the half of the dealer's pit above the rail; the bottom one the plates under the lowest chairs;
	 the side ones half a chair. -->
<div
	class="relative mx-auto h-[31.25rem] w-full shrink-0 px-12 pt-12 pb-14 wide:h-[30.75rem] wide:aspect-[2.15] wide:w-auto wide:max-w-full wide:px-16 wide:pt-12 wide:pb-14"
>
	<div class="table-rim u relative h-full w-full p-3 wide:p-4">
		<div class="felt u relative h-full w-full">
			<div
				class="inlay u pointer-events-none absolute inset-2 wide:inset-3"
				aria-hidden="true"
			></div>
			{#if name}
				<!-- Printed faintly at the foot of the felt, clear of the middle of the table. -->
				<span
					class="pointer-events-none absolute inset-x-0 bottom-[3%] text-center font-display text-lg font-bold text-paper/[0.08] italic wide:text-2xl"
					aria-hidden="true">{name}</span
				>
			{/if}
			<!-- The safe zone: the felt less the chairs on its rail and the dealer at its head. -->
			<div
				class="absolute inset-x-[15%] top-[18%] bottom-[22%] grid grid-cols-[minmax(0,1fr)] place-items-center wide:inset-x-[13%] wide:top-[16%] wide:bottom-[22%]"
				data-centre
			>
				{@render children()}
			</div>
		</div>
	</div>
	<div
		class="pointer-events-none absolute inset-x-12 top-12 bottom-14 wide:inset-x-16 wide:top-12 wide:bottom-14"
		bind:clientWidth={width}
		bind:clientHeight={height}
	>
		{#if direction !== null}
			<!-- The turn order: a brass chevron on the rail between each pair of neighbouring chairs. -->
			<p class="sr-only" aria-live="polite">
				{direction === 1 ? 'Play goes clockwise' : 'Play goes counter-clockwise'}
			</p>
			{#each chevrons as chevron, index (index)}
				<svg
					class="chevron absolute size-4 text-brass wide:size-5"
					style="left: {chevron.x}%; top: {chevron.y}%; --heading: {chevron.angle}deg; --flip: {direction ===
					1
						? 0
						: 180}deg"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="2.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M6 4l6 6-6 6" />
				</svg>
			{/each}
		{/if}
		{#each Array(count) as _, k (k)}
			<div class="pointer-events-auto absolute -translate-x-1/2 {anchor(k)}" style={position(k)}>
				{@render seat(k)}
			</div>
		{/each}
	</div>
</div>

<style>
	/* Flat top edge for the dealer, straight arms, then a half-ellipse along the bottom (62% = 100 - CURVE_TOP). */
	.u {
		border-radius: 1.5rem 1.5rem 50% 50% / 1.5rem 1.5rem 62% 62%;
	}
	.table-rim {
		background: linear-gradient(160deg, var(--color-rim-light), var(--color-rim) 45%, #2e1c10);
		box-shadow:
			0 30px 60px rgb(0 0 0 / 0.6),
			inset 0 2px 0 rgb(255 255 255 / 0.12),
			inset 0 -3px 6px rgb(0 0 0 / 0.4);
	}
	.inlay {
		box-shadow: inset 0 0 0 1px rgb(210 165 76 / 0.3);
	}
	.felt {
		background:
			radial-gradient(ellipse at 50% 40%, rgb(255 255 255 / 0.07), transparent 60%),
			radial-gradient(ellipse at center, var(--color-felt) 0%, var(--color-felt-deep) 100%);
		box-shadow:
			inset 0 0 0 2px rgb(210 165 76 / 0.25),
			inset 0 0 40px rgb(0 0 0 / 0.55);
	}
	/* Each chevron follows the rail's heading, sits halfway into the rail (its inner side is local +y once turned),
	   and a reverse turns it round on the spot. */
	.chevron {
		--inset: 6px;
		transform: translate(-50%, -50%) rotate(var(--heading)) translateY(var(--inset))
			rotate(var(--flip));
		transition: transform 500ms cubic-bezier(0.3, 0.7, 0.3, 1.2);
	}
	:global([data-stage='wide']) .chevron {
		--inset: 8px;
	}
	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
