<script lang="ts" module>
	/** 24×24 stroke icons, drawn by hand for the few places the backoffice needs one. */
	const PATHS = {
		overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
		players:
			'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
		matches:
			'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 9l5 3-5 3z',
		tournaments: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
		audit: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
		live: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2',
		admins:
			'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
		menu: 'M4 6h16M4 12h16M4 18h16',
		close: 'M18 6 6 18M6 6l12 12',
		search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
		signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
		arrowRight: 'M5 12h14M13 6l6 6-6 6'
	};

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let { name, class: className = 'size-5' }: { name: IconName; class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={PATHS[name]} />
</svg>
