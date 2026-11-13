<script lang="ts">
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';

	/**
	 * The table's recent moves, as the dealer would say them: the newest in a pill, the ones before
	 * it fading out underneath. `moveKey` (the game's move counter) tells a new move from a re-render,
	 * so the same line twice in a row still counts twice; a lower one means a fresh table.
	 */
	let { text, moveKey }: { text: string; moveKey: number } = $props();

	const HISTORY_SIZE = 3;
	const MOTION_MS = 220;

	type Entry = { id: number; text: string };
	let entries = $state<Entry[]>([]);
	let lastKey = -1;

	$effect(() => {
		const key = moveKey;
		const line = text;
		if (key === lastKey) return;

		const freshTable = key < lastKey;
		lastKey = key;

		const earlier = freshTable ? [] : untrack(() => entries);
		if (!line) {
			entries = earlier;
			return;
		}

		entries = [{ id: key, text: line }, ...earlier].slice(0, HISTORY_SIZE);
	});

	const duration = $derived(prefersReducedMotion.current ? 0 : MOTION_MS);

	/** Older lines fade further the longer ago they happened. */
	const OLDER_TONE = ['text-paper/55', 'text-paper/35'];
</script>

<p class="sr-only" aria-live="polite">{entries[0]?.text ?? ''}</p>

<!-- Fixed height, so the log never pushes the hand down as lines come and go. -->
<ol
	class="mx-auto my-2 flex h-20 max-w-md flex-col items-center gap-1 px-4 sm:my-3 sm:h-24"
	aria-label="Recent moves"
>
	{#each entries as entry, index (entry.id)}
		<li class="max-w-full" animate:flip={{ duration }} in:fly={{ y: -6, duration }}>
			{#if index === 0}
				<p
					class="flex items-center gap-2 rounded-xl border border-paper/10 bg-black/35 px-3 py-1 text-center text-xs text-paper/90 sm:px-3.5 sm:py-1.5 sm:text-sm"
				>
					<span class="size-1.5 shrink-0 rounded-full bg-brass" aria-hidden="true"></span>
					<span class="line-clamp-2">{entry.text}</span>
				</p>
			{:else}
				<p class="truncate px-3 text-[11px] sm:text-xs {OLDER_TONE[index - 1]}">{entry.text}</p>
			{/if}
		</li>
	{/each}
</ol>
