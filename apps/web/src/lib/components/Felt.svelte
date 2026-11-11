<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Oval card table; `seats` are placed around the rim, seat 0 at the bottom (the viewer). */
	let { count, seat, children }: { count: number; seat: Snippet<[number]>; children: Snippet } = $props();

	function position(k: number) {
		const angle = Math.PI / 2 + (k * 2 * Math.PI) / count; // clockwise from the bottom
		return `left: ${50 + 50 * Math.cos(angle)}%; top: ${50 + 50 * Math.sin(angle)}%;`;
	}
</script>

<div class="relative mx-auto aspect-[3/4] w-full max-w-3xl px-10 py-14 sm:aspect-[16/10] sm:px-16 sm:py-16">
	<div class="table-rim relative h-full w-full rounded-[50%] p-3 sm:p-4">
		<div class="felt relative grid h-full w-full place-items-center rounded-[50%]">
			{@render children()}
		</div>
	</div>
	<div class="pointer-events-none absolute inset-10 sm:inset-x-16 sm:inset-y-16">
		{#each Array(count) as _, k (k)}
			<div class="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={position(k)}>
				{@render seat(k)}
			</div>
		{/each}
	</div>
</div>

<style>
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
