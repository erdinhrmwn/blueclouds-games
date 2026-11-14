<script lang="ts">
	import type { Snippet } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';

	/**
	 * A finished table's result, in a modal over the table (Erdin, 2026-11-14), so the felt keeps its cards and the
	 * chairs keep their places. It opens once the last card has landed; "See the table" closes it, and the table
	 * shows a button to open it again.
	 */
	let {
		open = $bindable(false),
		title,
		winner,
		details,
		actions
	}: {
		open?: boolean;
		/** "You won", "You lost this one"… */
		title: string;
		winner: string;
		/** Under the winner, e.g. everyone's final points. */
		details?: Snippet;
		/** What comes next: play again, wait for the host, or the tournament's next round. */
		actions: Snippet;
	} = $props();

	/** Time to see the last card land before the modal covers the table. */
	const OPEN_AFTER_MS = 1_500;

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		const delay = prefersReducedMotion.current ? 0 : OPEN_AFTER_MS;
		const timer = setTimeout(() => {
			open = true;
		}, delay);

		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (open && !dialog.open) {
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="result-title"
	class="modal text-center"
>
	<p class="label">{title}</p>
	<h2
		id="result-title"
		class="winner mt-1 font-display text-4xl font-black text-brass"
		class:still={prefersReducedMotion.current}
	>
		{winner}
	</h2>
	{#if details}
		<div class="mt-3">{@render details()}</div>
	{/if}
	<div class="mt-5 border-t border-paper/10 pt-5">
		{@render actions()}
	</div>
	<button class="link-btn mt-3" onclick={() => (open = false)}>See the table</button>
</dialog>

<style>
	/* Winner's name rises into the placard, then settles with a slow glow. */
	.winner {
		animation:
			rise 700ms cubic-bezier(0.2, 0.8, 0.3, 1.2) both,
			glow 2.4s ease-in-out 700ms infinite alternate;
	}
	.winner.still {
		animation: none;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(24px) scale(0.6);
		}
	}
	@keyframes glow {
		to {
			text-shadow: 0 0 24px rgb(210 165 76 / 0.55);
		}
	}
</style>
