<script lang="ts">
	import { when } from '#lib/when.ts';
	import type { Snippet } from 'svelte';

	/**
	 * The top of a tournament card or its Detail dialog: the game's felt with two of its card backs, the status as a
	 * dark chip (it reads on any felt) and when it starts. `children` sits top right, like the dialog's close button.
	 */
	let {
		label,
		dot,
		startsAt,
		back,
		children
	}: {
		label: string;
		/** The dot's colour class, e.g. `bg-go`. */
		dot: string;
		startsAt: string;
		/** The game's card back utility, e.g. `table-back-bust-31`. */
		back: string;
		children?: Snippet;
	} = $props();
</script>

<div class="band relative h-[4.75rem] overflow-hidden border-b border-brass/35 px-4 pt-3.5">
	<span
		class="inline-flex items-center gap-1.5 rounded-full bg-room/85 px-2.5 py-1 text-xs font-semibold text-paper ring-1 ring-paper/10"
	>
		<span class="size-1.5 rounded-full {dot}" aria-hidden="true"></span>
		{label}
	</span>
	<p class="mt-2 text-sm font-bold text-paper">{when(startsAt)}</p>
	<!-- With something top right, the backs step left to clear it. -->
	<div class="absolute top-2 {children ? 'right-16' : 'right-5'} flex" aria-hidden="true">
		<span class="card-back {back} mt-1 -mr-3 block h-14 w-10 -rotate-12"></span>
		<span class="card-back {back} block h-14 w-10 rotate-6"></span>
	</div>
	{#if children}
		<div class="absolute top-3 right-3">{@render children()}</div>
	{/if}
</div>

<style>
	.band {
		background:
			radial-gradient(ellipse at 30% 20%, rgb(255 255 255 / 0.08), transparent 60%),
			radial-gradient(ellipse at center, var(--color-felt) 0%, var(--color-felt-deep) 100%);
	}
</style>
