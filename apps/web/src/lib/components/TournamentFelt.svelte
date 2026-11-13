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
		countdown,
		children
	}: {
		label: string;
		/** The dot's colour class, e.g. `bg-go`. */
		dot: string;
		startsAt: string;
		/** The game's card back utility, e.g. `table-back-bust-31`. */
		back: string;
		/** The Detail dialog's big "Starts in 6h 32m"; the band grows to hold it. */
		countdown?: string;
		children?: Snippet;
	} = $props();

	const backsPlace = $derived.by(() => {
		if (countdown) {
			return 'top-14 right-5';
		}

		if (children) {
			return 'top-2 right-16';
		}

		return 'top-2 right-5';
	});
</script>

<div
	class="band relative shrink-0 overflow-hidden border-b border-brass/35 {countdown
		? 'h-36 px-6 pt-5'
		: 'h-[4.75rem] px-4 pt-3.5'}"
>
	<span
		class="inline-flex items-center gap-1.5 rounded-full bg-room/85 px-2.5 py-1 text-xs font-semibold text-paper ring-1 ring-paper/10"
	>
		<span class="size-1.5 rounded-full {dot}" aria-hidden="true"></span>
		{label}
	</span>
	{#if countdown}
		<p class="relative mt-3 font-display text-[28px] leading-tight font-bold text-paper">
			{countdown}
		</p>
		<p class="relative mt-1 text-sm font-semibold text-paper/80">{when(startsAt)}</p>
	{:else}
		<p class="mt-2 text-sm font-bold text-paper">{when(startsAt)}</p>
	{/if}
	<!-- The backs keep clear of what is top right: below it in the tall band, beside it in the short one. -->
	<div class="absolute {backsPlace} flex" aria-hidden="true">
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
