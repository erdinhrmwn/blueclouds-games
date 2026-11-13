<script lang="ts">
	import type { Card } from 'server/games/cloudburst/rules';
	import { SUIT_NAME } from './suits.ts';

	let {
		card,
		size = 'md',
		fits = true,
		disabled = false,
		selected = false,
		label,
		onplay
	}: {
		card: Card;
		/** `xs`: the tiny cards of the round-end reveal at a seat; `pile`: the middle of the table. */
		size?: 'xs' | 'pile' | 'sm' | 'md' | 'lg';
		/** In your hand: false dims the card and says so. */
		fits?: boolean;
		disabled?: boolean;
		selected?: boolean;
		/** What the button does, for screen readers ("Play", "Give"). */
		label?: string;
		onplay?: (id: string) => void;
	} = $props();

	const WORD = { calm: 'Calm', swirl: 'Swirl', gust: 'Gust' } as const;

	/** The card faces are drawn in FigCraft (design/cards.figcraft) and exported to static/cards. */
	const face = $derived.by(() => {
		if (card.kind === 'rainbow') {
			return 'rainbow';
		}
		if (card.kind === 'number') {
			return `${card.suit}-${card.value}`;
		}

		return `${card.suit}-${card.kind}`;
	});
	const src = $derived(`/cards/cloudburst/${face}.svg`);

	/** What a screen reader says: "Sun 7", "Rain Gust" or "Rainbow". */
	const spoken = $derived.by(() => {
		if (card.kind === 'rainbow') {
			return 'Rainbow';
		}

		const value = card.kind === 'number' ? card.value : WORD[card.kind];
		return `${SUIT_NAME[card.suit!]} ${value}`;
	});
</script>

{#if onplay}
	<button
		type="button"
		class="card {size} interactive"
		class:dim={!fits}
		class:selected
		{disabled}
		onclick={() => onplay(card.id)}
		aria-label="{label ?? 'Play'} {spoken}{fits ? '' : ', does not fit'}"
		aria-pressed={selected || undefined}
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
	.xs {
		width: 1.75rem;
		height: 2.5rem;
		border-radius: 0.3rem;
	}
	/* The cards in the middle of the table, smaller than the hand. */
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
		width: 3.25rem;
		height: 4.6rem;
	}
	.md {
		width: 4.75rem;
		height: 6.75rem;
	}
	.lg {
		width: 4rem;
		height: 5.7rem;
	}
	@media (min-width: 640px) {
		.lg {
			width: 5.5rem;
			height: 7.9rem;
		}
	}
	.interactive {
		cursor: pointer;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			filter 160ms ease;
	}
	.interactive:not(:disabled):not(.dim):hover,
	.interactive:not(:disabled):focus-visible,
	.selected {
		transform: translateY(-14px) rotate(0deg) !important;
	}
	.interactive:not(:disabled):not(.dim):hover,
	.selected {
		box-shadow: 0 14px 24px rgb(0 0 0 / 0.5);
	}
	/* The ring is an outline, not a transitioned shadow, so it shows at once for keyboard users. */
	.interactive:focus-visible,
	.selected {
		outline: 2px solid var(--color-brass);
		outline-offset: 0;
	}
	.interactive:not(:disabled):active {
		transform: translateY(-10px) rotate(0deg) !important;
	}
	.dim {
		filter: saturate(0.35) brightness(0.62);
	}
	.interactive:disabled {
		cursor: not-allowed;
	}
	@media (prefers-reduced-motion: reduce) {
		.interactive {
			transition: none;
		}
	}
</style>
