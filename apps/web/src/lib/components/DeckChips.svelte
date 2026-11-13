<script lang="ts">
	import { cardFace } from '#lib/rounds.ts';

	/** A revealed deck drawn as small cards, top first. */
	let { game, deck }: { game: string; deck: string[] } = $props();
</script>

<ol class="flex flex-wrap gap-1.5" aria-label="Deck, top first">
	{#each deck as id, index (id)}
		{@const face = cardFace(game, id)}
		<li
			class="flex h-9 w-[1.625rem] items-center justify-center rounded bg-paper font-display text-[13px] font-black shadow-chip {face.ink}"
			aria-label="{index + 1}: {face.spoken}"
		>
			{face.mark}
		</li>
	{/each}
</ol>
