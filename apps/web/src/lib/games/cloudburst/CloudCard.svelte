<script lang="ts">
	import { type Card, SUITS } from 'server/games/cloudburst/rules';
	import SuitGlyph from './SuitGlyph.svelte';
	import { SUIT_BG, SUIT_NAME, SUIT_TEXT } from './suits.ts';

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
		/** `xs`: the tiny cards of the round-end reveal at a seat. */
		size?: 'xs' | 'sm' | 'md' | 'lg';
		/** In your hand: false dims the card and says so. */
		fits?: boolean;
		disabled?: boolean;
		selected?: boolean;
		/** What the button does, for screen readers ("Play", "Give"). */
		label?: string;
		onplay?: (id: string) => void;
	} = $props();

	const WORD = { calm: 'Calm', swirl: 'Swirl', gust: 'Gust' } as const;

	/** The corner mark: the number, an action's first letter, or nothing for a Rainbow. */
	const corner = $derived.by(() => {
		if (card.kind === 'number') return String(card.value);
		if (card.kind === 'rainbow') return '';
		return WORD[card.kind][0];
	});

	/** What a screen reader says: "Sun 7", "Rain Gust" or "Rainbow". */
	const spoken = $derived.by(() => {
		if (card.kind === 'rainbow') return 'Rainbow';

		const face = card.kind === 'number' ? card.value : WORD[card.kind];
		return `${SUIT_NAME[card.suit!]} ${face}`;
	});
</script>

{#snippet face()}
	{#if card.kind === 'rainbow'}
		<span class="rainbow" aria-hidden="true">
			{#each SUITS as s (s)}<span class="band {SUIT_BG[s]}"></span>{/each}
		</span>
		<span class="word relative font-display text-sm font-bold text-paper">Rainbow</span>
	{:else}
		<span class="corner top-1.5 left-1.5 flex flex-col items-center">
			<span>{corner}</span><SuitGlyph suit={card.suit!} class="size-3" />
		</span>
		{#if card.kind === 'number'}
			<span class="num font-display leading-none font-black">{card.value}</span>
			<SuitGlyph suit={card.suit!} class="glyph" />
		{:else}
			<svg
				viewBox="0 0 24 24"
				class="glyph-lg"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if card.kind === 'calm'}
					<path d="M5 10h14M5 14h14" />
				{:else if card.kind === 'swirl'}
					<path d="M4 9h13l-3-3M20 15H7l3 3" />
				{:else}
					<rect x="3.5" y="6" width="9" height="12" rx="1.5" /><path
						d="M15 12h6m-2.5-2.5L21 12l-2.5 2.5"
					/>
				{/if}
			</svg>
			<span class="word text-[11px] font-semibold">{WORD[card.kind]}</span>
		{/if}
		<span class="corner right-1.5 bottom-1.5 flex rotate-180 flex-col items-center">
			<span>{corner}</span><SuitGlyph suit={card.suit!} class="size-3" />
		</span>
	{/if}
{/snippet}

{#if onplay}
	<button
		type="button"
		class="card {size} {card.suit ? SUIT_TEXT[card.suit] : ''} interactive"
		class:dim={!fits}
		class:selected
		{disabled}
		onclick={() => onplay(card.id)}
		aria-label="{label ?? 'Play'} {spoken}{fits ? '' : ', does not fit'}"
		aria-pressed={selected || undefined}
	>
		{@render face()}
	</button>
{:else}
	<div
		class="card {size} {card.suit ? SUIT_TEXT[card.suit] : ''}"
		role="img"
		aria-label="Card, {spoken}"
	>
		{@render face()}
	</div>
{/if}

<style>
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		border-radius: 0.5rem;
		background: var(--color-paper);
		box-shadow:
			inset 0 0 0 1px rgb(34 28 22 / 0.15),
			inset 0 0 0 4px var(--color-paper),
			inset 0 0 0 5px rgb(34 28 22 / 0.12),
			0 6px 14px rgb(0 0 0 / 0.45);
	}
	.xs {
		width: 1.75rem;
		height: 2.5rem;
		border-radius: 0.3rem;
		gap: 0;
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
	.num {
		font-size: 2.4em;
	}
	.xs .num {
		font-size: 1rem;
	}
	.sm .num {
		font-size: 1.6rem;
	}
	.md .num,
	.lg .num {
		font-size: 2.75rem;
	}
	@media (max-width: 639px) {
		.lg .num {
			font-size: 2.25rem;
		}
		.lg :global(.glyph-lg) {
			width: 1.5rem;
			height: 1.5rem;
		}
	}
	.card :global(.glyph) {
		width: 1.1rem;
		height: 1.1rem;
	}
	.card :global(.glyph-lg) {
		width: 1.9rem;
		height: 1.9rem;
	}
	.xs :global(.glyph) {
		width: 0.6rem;
		height: 0.6rem;
	}
	.xs :global(.glyph-lg) {
		width: 1rem;
		height: 1rem;
	}
	/* Too small for words: the glyph (or the four bands) says what the card is. */
	.xs .word {
		display: none;
	}
	.sm :global(.glyph-lg) {
		width: 1.3rem;
		height: 1.3rem;
	}
	.corner {
		position: absolute;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 0.75rem;
		line-height: 1;
	}
	.xs .corner,
	.sm .corner {
		display: none;
	}
	/* Rainbow: ink face with four flat bands, one per suit colour. */
	.rainbow {
		position: absolute;
		inset: 5px;
		display: grid;
		grid-template-rows: repeat(4, 1fr);
		overflow: hidden;
		border-radius: 0.3rem;
		background: var(--color-ink);
		padding: 22% 0;
		gap: 3px;
	}
	.xs .rainbow {
		inset: 3px;
		gap: 2px;
	}
	.band {
		display: block;
		opacity: 0.9;
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
		box-shadow:
			inset 0 0 0 1px rgb(34 28 22 / 0.15),
			inset 0 0 0 4px var(--color-paper),
			inset 0 0 0 5px rgb(34 28 22 / 0.12),
			0 0 0 2px var(--color-brass),
			0 14px 24px rgb(0 0 0 / 0.5);
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
