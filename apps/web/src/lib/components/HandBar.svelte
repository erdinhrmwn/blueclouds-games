<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One centred line above your hand: whose turn it is (and the seconds left on yours), then your
	 * move button. The cards under it stay the focus.
	 */
	let {
		active,
		label,
		secondsLeft,
		actions
	}: {
		active: boolean;
		label: string;
		secondsLeft: number | null;
		actions?: Snippet;
	} = $props();

	const URGENT_SECONDS = 5;

	const showSeconds = $derived(active && secondsLeft !== null);
	const urgent = $derived(showSeconds && secondsLeft !== null && secondsLeft <= URGENT_SECONDS);
</script>

<div class="flex min-h-8 items-center justify-center gap-3">
	<p class="flex items-baseline gap-2 text-sm">
		<span class="font-semibold {active ? 'text-brass' : 'text-paper/60'}" aria-live="polite">
			{label}
		</span>
		{#if showSeconds}
			<span class="tabular-nums {urgent ? 'font-semibold text-ember' : 'text-paper/55'}">
				<span class="sr-only">Time left:</span>{secondsLeft}s
			</span>
		{/if}
	</p>

	{#if active && actions}
		{@render actions()}
	{/if}

	{#if urgent}
		<p class="sr-only" role="alert">Time is almost up. A move will be made for you.</p>
	{/if}
</div>
