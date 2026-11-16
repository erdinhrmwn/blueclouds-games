<svelte:options namespace="svg" />

<script lang="ts">
	import type { AvatarIcon } from 'server/games/shared/avatars';

	/**
	 * A preset avatar icon (FigCraft page "Brand · Avatars") on a 24 grid, in currentColor. Inner details
	 * (pips, facets, veins) are cut out in `--avatar-tile`, the tile's own colour.
	 */
	let { icon }: { icon: AvatarIcon } = $props();
</script>

{#if icon === 'cloud'}
	<g transform="translate(0.77 1.84) scale(0.36)"
		><path
			d="M15 46 A10 10 0 0 1 12.6 27.4 A15 15 0 0 1 40.5 20.5 A12.5 12.5 0 0 1 51 46 Z"
			fill="currentColor"
		/></g
	>
{:else if icon === 'sun'}
	<circle cx="12" cy="12" r="4.8" fill="currentColor" /><path
		d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'moon'}
	<path d="M19.5 14.5A8.5 8.5 0 1 1 9.5 4.5a7 7 0 0 0 10 10Z" fill="currentColor" />
{:else if icon === 'star'}
	<path
		d="M12.00 3.10 L14.47 9.20 L21.04 9.66 L15.99 13.90 L17.58 20.29 L12.00 16.80 L6.42 20.29 L8.01 13.90 L2.96 9.66 L9.53 9.20 Z"
		fill="currentColor"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'bolt'}
	<path
		d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.5L13.5 2Z"
		fill="currentColor"
		stroke="currentColor"
		stroke-width="1"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'drop'}
	<path d="M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11Z" fill="currentColor" />
{:else if icon === 'snow'}
	<path
		d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/><path
		d="M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2M4.6 10.5l3-1-.5-3M19.4 13.5l-3 1 .5 3M4.6 13.5l3 1-.5 3M19.4 10.5l-3-1 .5-3"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'rainbow'}
	<path
		d="M3 18a9 9 0 0 1 18 0"
		fill="none"
		stroke="currentColor"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	/><path
		d="M6.5 18a5.5 5.5 0 0 1 11 0"
		fill="none"
		stroke="currentColor"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	/><path
		d="M10 18a2 2 0 0 1 4 0"
		fill="none"
		stroke="currentColor"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'leaf'}
	<path d="M4.5 19.5C4.5 10.5 9.5 4.5 19.5 4.5c0 10-6 15-15 15Z" fill="currentColor" /><path
		d="M5 19L14 10"
		fill="none"
		stroke="var(--avatar-tile)"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'flame'}
	<path
		d="M12 2.5c.8 4.2 6.5 6.2 6.5 11.5a6.5 6.5 0 0 1-13 0c0-3.2 2-5.2 3.2-6.3.1 2 1 3.3 2.3 3.6-.4-3.1-.4-5.8 1-8.8Z"
		fill="currentColor"
	/>
{:else if icon === 'kite'}
	<path d="M12 2.5l6.5 7.5-6.5 8-6.5-8Z" fill="currentColor" /><path
		d="M5.5 10h13M12 2.5V18"
		fill="none"
		stroke="var(--avatar-tile)"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	/><path
		d="M12 18c-1.5 1.5 1.5 2.5 0 4"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'crown'}
	<path
		d="M4 17L3 7.5l5 4 4-7 4 7 5-4-1 9.5Z"
		fill="currentColor"
		stroke="currentColor"
		stroke-width="1.2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/><rect x="4" y="18.5" width="16" height="2.5" rx="1.2" fill="currentColor" />
{:else if icon === 'chip'}
	<circle cx="12" cy="12" r="9.4" fill="currentColor" /><rect
		x="10.6"
		y="2.6"
		width="2.8"
		height="3.4"
		rx="0.6"
		fill="var(--avatar-tile)"
		transform="rotate(0 12 12)"
	/><rect
		x="10.6"
		y="2.6"
		width="2.8"
		height="3.4"
		rx="0.6"
		fill="var(--avatar-tile)"
		transform="rotate(60 12 12)"
	/><rect
		x="10.6"
		y="2.6"
		width="2.8"
		height="3.4"
		rx="0.6"
		fill="var(--avatar-tile)"
		transform="rotate(120 12 12)"
	/><rect
		x="10.6"
		y="2.6"
		width="2.8"
		height="3.4"
		rx="0.6"
		fill="var(--avatar-tile)"
		transform="rotate(180 12 12)"
	/><rect
		x="10.6"
		y="2.6"
		width="2.8"
		height="3.4"
		rx="0.6"
		fill="var(--avatar-tile)"
		transform="rotate(240 12 12)"
	/><rect
		x="10.6"
		y="2.6"
		width="2.8"
		height="3.4"
		rx="0.6"
		fill="var(--avatar-tile)"
		transform="rotate(300 12 12)"
	/><circle cx="12" cy="12" r="4.6" fill="none" stroke="var(--avatar-tile)" stroke-width="1.5" />
{:else if icon === 'die'}
	<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="currentColor" /><circle
		cx="8"
		cy="8"
		r="1.5"
		fill="var(--avatar-tile)"
	/><circle cx="16" cy="8" r="1.5" fill="var(--avatar-tile)" /><circle
		cx="12"
		cy="12"
		r="1.5"
		fill="var(--avatar-tile)"
	/><circle cx="8" cy="16" r="1.5" fill="var(--avatar-tile)" /><circle
		cx="16"
		cy="16"
		r="1.5"
		fill="var(--avatar-tile)"
	/>
{:else if icon === 'gem'}
	<path d="M7 4h10l4 5-9 11L3 9l4-5Z" fill="currentColor" /><path
		d="M3 9h18M9.5 9 12 19.5 14.5 9M10 4l-.5 5M14 4l.5 5"
		fill="none"
		stroke="var(--avatar-tile)"
		stroke-width="1.2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{:else if icon === 'anchor'}
	<circle cx="12" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="2" /><path
		d="M12 7.2V21M5 13.5a7 7 0 0 0 14 0M8.5 10.5h7M3.5 15l1.5-1.5 1.5 1.5M17.5 15l1.5-1.5 1.5 1.5"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{/if}
