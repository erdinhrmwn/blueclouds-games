<script lang="ts">
	import { stage } from '#lib/stage.svelte.ts';
	import type { Snippet } from 'svelte';

	/**
	 * Your hand and what goes with it: whose turn it is (and the seconds left on yours) and your move button. On the
	 * tall stage they share one line above the cards; on the wide one they flank the cards, the turn on the left and
	 * the move on the right, so the hand takes no more height than its cards.
	 */
	let {
		active,
		label,
		secondsLeft,
		actions,
		children
	}: {
		active: boolean;
		label: string;
		secondsLeft: number | null;
		actions?: Snippet;
		/** The cards. */
		children: Snippet;
	} = $props();

	const URGENT_SECONDS = 5;

	const showSeconds = $derived(active && secondsLeft !== null);
	const urgent = $derived(showSeconds && secondsLeft !== null && secondsLeft <= URGENT_SECONDS);
</script>

{#snippet seconds()}
	{#if showSeconds}
		<span class="tabular-nums {urgent ? 'font-semibold text-ember' : 'text-paper/60'}">
			<span class="sr-only">Time left:</span>{secondsLeft}s
		</span>
	{/if}
{/snippet}

<!-- Pinned to the foot of the stage, under whatever space the felt and the dealer's line leave. -->
<section aria-label="Your hand" class="mt-auto shrink-0">
	{#if stage.wide}
		<div class="grid grid-cols-[1fr_minmax(0,40rem)_1fr] items-center gap-8">
			<div class="justify-self-end text-right">
				<p
					class="font-display text-2xl leading-tight font-bold {active
						? 'text-brass'
						: 'text-paper/60'}"
					aria-live="polite"
				>
					{label}
				</p>
				<p class="mt-0.5 text-sm">{@render seconds()}</p>
			</div>
			<div class="min-w-0">{@render children()}</div>
			<div class="justify-self-start">
				{#if active && actions}
					{@render actions()}
				{/if}
			</div>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-2">
			<div class="flex min-h-8 items-center justify-center gap-3">
				<p class="flex items-baseline gap-2 text-sm">
					<span class="font-semibold {active ? 'text-brass' : 'text-paper/60'}" aria-live="polite">
						{label}
					</span>
					{@render seconds()}
				</p>
				{#if active && actions}
					{@render actions()}
				{/if}
			</div>
			{@render children()}
		</div>
	{/if}

	{#if urgent}
		<p class="sr-only" role="alert">Time is almost up. A move will be made for you.</p>
	{/if}
</section>
