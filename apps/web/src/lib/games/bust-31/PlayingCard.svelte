<script lang="ts">
	import type { Card } from 'server/games/bust-31/rules';

	let {
		card,
		size = 'md',
		disabled = false,
		onplay
	}: {
		card: Card;
		size?: 'sm' | 'md' | 'lg';
		disabled?: boolean;
		onplay?: (id: string) => void;
	} = $props();

	// corner glyph, caption, ink colour per card kind
	const LOOK: Record<Card['kind'], [string, string, string]> = {
		number: ['', '', 'text-ink'],
		zero: ['0', 'skip', 'text-[#3d5a6c]'],
		minus: ['−5', 'down', 'text-[#2f6b4f]'],
		reverse: ['⇄', 'flip', 'text-[#a8401f]']
	};

	const [glyph, caption, ink] = $derived(LOOK[card.kind]);
	const label = $derived(card.kind === 'number' ? String(card.value) : glyph);
	const spoken = $derived(card.kind === 'number' ? `plus ${card.value}` : caption);

	const LABEL_SIZE = { lg: 'text-6xl', md: 'text-5xl', sm: 'text-4xl' } as const;
	const labelSize = $derived(LABEL_SIZE[size]);
</script>

{#snippet face()}
	<span class="corner top-1.5 left-2">{label}</span>
	<span class="font-display font-black {labelSize} leading-none">{label}</span>
	{#if caption}<span class="mt-1 text-[11px] font-medium opacity-80">{caption}</span>{/if}
	<span class="corner right-2 bottom-1.5 rotate-180">{label}</span>
{/snippet}

{#if onplay}
	<button
		type="button"
		class="card {size} {ink} interactive"
		{disabled}
		onclick={() => onplay(card.id)}
		aria-label="Play card, {spoken}"
	>
		{@render face()}
	</button>
{:else}
	<div class="card {size} {ink}" role="img" aria-label="Card, {spoken}">
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
		border-radius: 0.5rem;
		background: var(--color-paper);
		background-image: radial-gradient(circle at 30% 20%, #fffaf0 0%, transparent 70%);
		box-shadow:
			inset 0 0 0 1px rgb(34 28 22 / 0.15),
			inset 0 0 0 5px var(--color-paper),
			inset 0 0 0 6px rgb(34 28 22 / 0.12),
			0 6px 14px rgb(0 0 0 / 0.45);
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
		width: 5.75rem;
		height: 8.25rem;
	}
	.corner {
		position: absolute;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 0.85rem;
		line-height: 1;
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
		box-shadow:
			inset 0 0 0 1px rgb(34 28 22 / 0.15),
			inset 0 0 0 5px var(--color-paper),
			inset 0 0 0 6px rgb(34 28 22 / 0.12),
			0 0 0 2px var(--color-brass),
			0 14px 24px rgb(0 0 0 / 0.5);
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
