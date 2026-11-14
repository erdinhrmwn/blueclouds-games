<script lang="ts">
	import { type Suit, SUITS } from 'server/games/cloudburst/rules';
	import SuitGlyph from './SuitGlyph.svelte';
	import { SUIT_NAME } from './suits.ts';

	/**
	 * The weather a Rainbow sets. The Rainbow is already chosen, so there is no way back: pick a suit,
	 * then Confirm. When the turn's clock runs out, the suit picked so far is played.
	 */
	let {
		open,
		nextName,
		secondsLeft,
		onpick
	}: {
		open: boolean;
		nextName: string;
		secondsLeft: number | null;
		onpick: (suit: Suit) => void;
	} = $props();

	/** Play the picked suit with this many seconds left, before the server plays for the player. */
	const AUTO_PICK_AT_S = 1;

	const FILL: Record<Suit, string> = {
		sun: 'bg-sun',
		rain: 'bg-rain',
		wind: 'bg-wind',
		storm: 'bg-storm'
	};

	let dialog = $state<HTMLDialogElement>();
	let picked = $state<Suit | null>(null);
	let sent = false;

	/** The chosen suit stands out; once one is picked, the others fade. */
	const pickClass = (chosen: boolean) => {
		if (chosen) {
			return 'chosen';
		}

		return picked ? 'opacity-55' : '';
	};

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (open && !dialog.open) {
			picked = null;
			sent = false;
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	function confirm() {
		if (!picked || sent) {
			return;
		}

		sent = true;
		onpick(picked);
	}

	// Time is nearly up: play the suit picked so far instead of letting the server choose.
	$effect(() => {
		if (!open || secondsLeft === null || secondsLeft > AUTO_PICK_AT_S) {
			return;
		}

		confirm();
	});

	/** Escape would close the dialog; the choice can't be undone, so it stays open. */
	function keepOpen(event: Event) {
		event.preventDefault();
	}
</script>

<dialog bind:this={dialog} oncancel={keepOpen} aria-labelledby="suit-picker-title" class="modal">
	<div class="flex items-baseline justify-between gap-4">
		<h2 id="suit-picker-title" class="modal-title">Pick the weather</h2>
		{#if secondsLeft !== null}
			<span
				class="rounded-full bg-black/35 px-2.5 py-0.5 text-sm font-semibold text-brass tabular-nums"
			>
				<span class="sr-only">Time left:</span>{secondsLeft}s
			</span>
		{/if}
	</div>
	<p class="mt-1 text-sm text-paper/65">{nextName} must follow it.</p>

	<div class="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Weather">
		{#each SUITS as suit (suit)}
			{@const chosen = picked === suit}
			<button
				role="radio"
				aria-checked={chosen}
				class="relative flex min-h-18 items-center gap-3 rounded-xl px-4 font-display text-lg font-bold text-paper transition active:translate-y-px motion-reduce:transition-none {FILL[
					suit
				]} {pickClass(chosen)}"
				onclick={() => (picked = suit)}
			>
				<SuitGlyph {suit} class="size-7" />
				{SUIT_NAME[suit]}
				{#if chosen}
					<svg
						viewBox="0 0 20 20"
						class="absolute top-2 right-2 size-5 rounded-full bg-paper p-0.5 text-ink"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M5 10.5l3 3 7-7" />
					</svg>
				{/if}
			</button>
		{/each}
	</div>

	<button class="btn-brass mt-5 w-full" onclick={confirm} disabled={!picked}>
		{picked ? `Confirm ${SUIT_NAME[picked]}` : 'Pick a suit'}
	</button>
</dialog>

<style>
	.chosen {
		box-shadow: 0 0 0 2.5px var(--color-paper);
	}
</style>
