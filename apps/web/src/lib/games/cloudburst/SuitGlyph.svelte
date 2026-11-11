<script lang="ts">
	import type { Suit } from 'server/games/cloudburst/rules';

	/** Each suit's own mark, so suits never depend on colour alone. Drawn in currentColor. */
	let { suit, class: cls = 'size-5' }: { suit: Suit; class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" class={cls} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#if suit === 'sun'}
		<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
		<path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
	{:else if suit === 'rain'}
		<path d="M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11Z" fill="currentColor" stroke="none" />
	{:else if suit === 'wind'}
		<path d="M3 8h10a3 3 0 1 0-3-3" />
		<path d="M3 12h15a3 3 0 1 1-3 3" />
		<path d="M3 16h7" />
	{:else}
		<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.5L13.5 2Z" fill="currentColor" stroke="none" />
	{/if}
</svg>
