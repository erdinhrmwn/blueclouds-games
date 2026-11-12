<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';

	/** What just happened at the table, as the dealer would say it. Empty shows nothing. */
	let { text }: { text: string } = $props();

	const ENTER_MS = 220;
</script>

<!-- Fixed height (room for two lines), so a longer line never pushes the hand down. -->
<div class="mx-auto my-3 flex h-14 max-w-md items-center justify-center px-4" aria-live="polite">
	{#key text}
		{#if text}
			<p
				class="flex items-center gap-2 rounded-xl border border-paper/10 bg-black/35 px-3.5 py-1.5 text-center text-sm text-paper/85"
				in:fly={{ y: 6, duration: prefersReducedMotion.current ? 0 : ENTER_MS }}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-brass" aria-hidden="true"></span>
				<span class="line-clamp-2">{text}</span>
			</p>
		{/if}
	{/key}
</div>
