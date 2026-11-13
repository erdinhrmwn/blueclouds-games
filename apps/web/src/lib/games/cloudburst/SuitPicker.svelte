<script lang="ts">
	import { type Suit, SUITS } from 'server/games/cloudburst/rules';
	import SuitGlyph from './SuitGlyph.svelte';
	import { SUIT_NAME, SUIT_TEXT } from './suits.ts';

	/** The weather a Rainbow sets, picked in a modal; Escape or Cancel puts the Rainbow back. */
	let {
		open,
		nextName,
		secondsLeft,
		onpick,
		oncancel
	}: {
		open: boolean;
		nextName: string;
		secondsLeft: number | null;
		onpick: (suit: Suit) => void;
		oncancel: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;

		if (open && !dialog.open) {
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	function cancel(event: Event) {
		event.preventDefault();
		oncancel();
	}
</script>

<dialog
	bind:this={dialog}
	oncancel={cancel}
	aria-labelledby="suit-picker-title"
	class="m-auto w-[min(22rem,calc(100%-2rem))] rounded-xl border border-paper/15 bg-[#1b1611] p-6 text-paper backdrop:bg-black/70"
>
	<div class="flex items-baseline justify-between gap-4">
		<h2 id="suit-picker-title" class="font-display text-xl font-bold">Pick the weather</h2>
		{#if secondsLeft !== null}
			<span class="text-sm text-paper/55 tabular-nums">
				<span class="sr-only">Time left:</span>{secondsLeft}s
			</span>
		{/if}
	</div>
	<p class="mt-1 text-sm text-paper/70">{nextName} must follow it.</p>

	<div class="mt-5 grid grid-cols-2 gap-3" role="group" aria-label="Weather">
		{#each SUITS as suit (suit)}
			<button
				class="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg bg-paper text-sm font-semibold transition hover:brightness-95 active:translate-y-px motion-reduce:transition-none {SUIT_TEXT[
					suit
				]}"
				onclick={() => onpick(suit)}
			>
				<SuitGlyph {suit} class="size-7" />
				{SUIT_NAME[suit]}
			</button>
		{/each}
	</div>

	<div class="mt-4 flex justify-center">
		<button class="link-btn" onclick={oncancel}>Cancel</button>
	</div>
</dialog>
