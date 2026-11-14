<script lang="ts">
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import Nimbus from './Nimbus.svelte';

	/**
	 * The table's recent moves, as the dealer would say them: the newest in a pill, the ones before
	 * it fading out underneath. `moveKey` (the game's move counter) tells a new move from a re-render,
	 * so the same line twice in a row still counts twice; a lower one means a fresh table.
	 */
	let { text, moveKey }: { text: string; moveKey: number } = $props();

	const HISTORY_SIZE = 2;
	const MOTION_MS = 220;

	type Entry = { id: number; text: string };
	let entries = $state<Entry[]>([]);
	let lastKey = -1;

	$effect(() => {
		const key = moveKey;
		const line = text;
		if (key === lastKey) {
			return;
		}

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
</script>

<p class="sr-only" aria-live="polite">{entries[0]?.text ?? ''}</p>

<!-- Nimbus says the latest move. Fixed height, so the log never pushes the hand down as lines come and go. On the tall
	 stage it sits between the table and your hand; on the wide one it is a speech bubble beside the dealer, at the
	 head of the table, with the move before it fading under it. -->
<ol
	class="mx-auto my-1 flex h-9 w-full max-w-md shrink-0 flex-col items-center gap-1 px-4 wide:absolute wide:top-[4.25rem] wide:left-[calc(50%+3.75rem)] wide:m-0 wide:h-16 wide:w-[22rem] wide:items-start wide:px-0"
	aria-label="Recent moves"
>
	{#each entries as entry, index (entry.id)}
		<li
			class="max-w-full {index ? 'hidden wide:block' : ''}"
			animate:flip={{ duration }}
			in:fly={{ y: -6, duration }}
		>
			{#if index === 0}
				<p
					class="bubble relative flex items-center gap-2 rounded-xl bg-paper px-3 py-1 text-center text-xs font-medium text-ink wide:rounded-2xl wide:rounded-tl-sm wide:px-3.5 wide:py-1.5 wide:text-left wide:text-sm"
				>
					<Nimbus head class="size-5 shrink-0 wide:hidden" />
					<span class="line-clamp-2">{entry.text}</span>
				</p>
			{:else}
				<p class="truncate pl-3.5 text-xs text-paper/45">{entry.text}</p>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.bubble {
		box-shadow: 0 4px 10px rgb(0 0 0 / 0.35);
	}
	/* The bubble's tail points back at Nimbus on the wide stage. */
	:global([data-stage='wide']) .bubble::before {
		content: '';
		position: absolute;
		top: 0;
		left: -0.5rem;
		border-width: 0 0.6rem 0.6rem 0;
		border-style: solid;
		border-color: transparent var(--color-paper) transparent transparent;
	}
</style>
