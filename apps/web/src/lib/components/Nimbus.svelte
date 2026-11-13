<script lang="ts">
	/**
	 * Nimbus, the house dealer at every BlueClouds table: a cloud in a green dealer's eyeshade and a brass
	 * bow tie (drawn in FigCraft, see design/cards.figcraft). `head` drops the shadow and bow tie for the
	 * tiny version in the move log.
	 */
	let { head = false, class: cls = 'size-14' }: { head?: boolean; class?: string } = $props();
</script>

<svg viewBox="-32 -32 64 64" class={cls} aria-hidden="true">
	{#if !head}
		<ellipse cx="0" cy="25" rx="26" ry="4" fill="#000" fill-opacity="0.35" />
		<circle cx="-15" cy="5" r="13" fill="#8fb3d6" />
		<circle cx="16" cy="6" r="12" fill="#8fb3d6" />
		<rect x="-27" y="2" width="54" height="20" rx="10" fill="#8fb3d6" />
	{/if}
	<circle cx="-14" cy="3" r="13" fill="#b7d2ec" />
	<circle cx="1" cy="-6" r="17" fill="#b7d2ec" />
	<circle cx="16" cy="4" r="12" fill="#b7d2ec" />
	<rect x="-27" y="0" width="54" height="19" rx="9.5" fill="#b7d2ec" />
	<path d="M-17 -12 Q1 -24 19 -12 L23 -7 Q1 -15 -21 -7 Z" fill="#2f6e4f" fill-opacity="0.92" />
	<path
		d="M-21 -7 Q1 -15 23 -7"
		fill="none"
		stroke="var(--color-brass)"
		stroke-width="1.6"
		stroke-linecap="round"
	/>
	<path
		d="M-9 4 q3 -3 6 0 M5 4 q3 -3 6 0"
		fill="none"
		stroke="var(--color-ink)"
		stroke-width={head ? 2.6 : 1.8}
		stroke-linecap="round"
	/>
	{#if !head}
		<circle cx="-12" cy="9" r="2.4" fill="#e79a8a" fill-opacity="0.55" />
		<circle cx="14" cy="9" r="2.4" fill="#e79a8a" fill-opacity="0.55" />
		<path
			d="M-2 9 q3 2.6 6 0"
			fill="none"
			stroke="var(--color-ink)"
			stroke-width="1.8"
			stroke-linecap="round"
		/>
		<path d="M1 21 L-6 17 L-6 25 Z M1 21 L8 17 L8 25 Z" fill="var(--color-brass)" />
		<circle cx="1" cy="21" r="2" fill="var(--color-brass-dim)" />
	{/if}
</svg>
