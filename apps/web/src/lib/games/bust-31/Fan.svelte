<script lang="ts">
	import PlayingCard from './PlayingCard.svelte';

	/** A small fan of sample cards: the game's picture on its home page and the landing page. */
	let { size = 'md' }: { size?: 'sm' | 'md' } = $props();

	const SAMPLE = [
		{ id: 's1', kind: 'number', value: 7 },
		{ id: 's2', kind: 'minus', value: -5 },
		{ id: 's3', kind: 'reverse', value: 0 }
	] as const;
</script>

<div class="flex" aria-hidden="true">
	{#each SAMPLE as card, i (card.id)}
		<div class="-mr-3" style="transform: rotate({(i - 1) * 8}deg) translateY({i === 1 ? -6 : 0}px)">
			<PlayingCard {card} {size} />
		</div>
	{/each}
</div>
