<script lang="ts">
	import type { Card } from 'server/games/bust-31/rules';

	let {
		card,
		size = 'md',
		disabled = false,
		onplay
	}: {
		card: Card;
		/** `pile`: the cards in the middle of the table, smaller than the hand. */
		size?: 'pile' | 'sm' | 'md' | 'lg';
		disabled?: boolean;
		onplay?: (id: string) => void;
	} = $props();

	/** What a screen reader says for each special card. */
	const SPOKEN: Record<Exclude<Card['kind'], 'number'>, string> = {
		zero: 'skip, adds 0',
		minus: 'minus 5',
		reverse: 'flip the turn order',
		swap: 'swap hands with the next player',
		ten: 'set the total to 10',
		double: 'next player plays 2 cards'
	};

	/** The card faces are drawn in FigCraft (design/cards.figcraft) and exported to static/cards. */
	const face = $derived(card.kind === 'number' ? `n${card.value}` : card.kind);
	const src = $derived(`/cards/bust-31/${face}.svg`);
	const spoken = $derived(card.kind === 'number' ? `plus ${card.value}` : SPOKEN[card.kind]);
</script>

{#if onplay}
	<button
		type="button"
		class="card {size} interactive"
		{disabled}
		onclick={() => onplay(card.id)}
		aria-label="Play card, {spoken}"
	>
		<img {src} alt="" draggable="false" />
	</button>
{:else}
	<div class="card {size}" role="img" aria-label="Card, {spoken}">
		<img {src} alt="" draggable="false" />
	</div>
{/if}

<style>
	.card {
		position: relative;
		display: block;
		border-radius: 0.5rem;
		box-shadow: 0 6px 14px rgb(0 0 0 / 0.45);
	}
	.card img {
		display: block;
		width: 100%;
		height: 100%;
		user-select: none;
	}
	.pile {
		width: 2.5rem;
		height: 3.55rem;
		border-radius: 0.3rem;
	}
	@media (min-width: 640px) {
		.pile {
			width: 3.25rem;
			height: 4.6rem;
		}
	}
	.sm {
		width: 3.5rem;
		height: 5rem;
	}
	.md {
		width: 4.75rem;
		height: 6.75rem;
	}
	.lg {
		width: 4.5rem;
		height: 6.5rem;
	}
	@media (min-width: 640px) {
		.lg {
			width: 5.75rem;
			height: 8.25rem;
		}
	}
	.interactive {
		cursor: pointer;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			filter 160ms ease;
	}
	.interactive:not(:disabled):hover,
	.interactive:not(:disabled):focus-visible {
		transform: translateY(-14px) rotate(0deg) !important;
	}
	.interactive:not(:disabled):hover {
		box-shadow: 0 14px 24px rgb(0 0 0 / 0.5);
	}
	/* The ring is an outline, not a transitioned shadow, so it shows at once for keyboard users. */
	.interactive:not(:disabled):hover,
	.interactive:focus-visible {
		outline: 2px solid var(--color-brass);
		outline-offset: 0;
	}
	.interactive:not(:disabled):active {
		transform: translateY(-10px) rotate(0deg) !important;
	}
	@media (prefers-reduced-motion: reduce) {
		.interactive {
			transition: none;
		}
	}
	.interactive:disabled {
		cursor: not-allowed;
		filter: saturate(0.4) brightness(0.75);
	}
</style>
