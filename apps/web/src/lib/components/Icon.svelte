<script lang="ts" module>
	/**
	 * The app's icon set (FigCraft page "Brand · Icons"): 24px grid, 2px round strokes, drawn in currentColor.
	 * Each icon is a list of shapes: `p` path, `c` circle [cx, cy, r], `r` rect [x, y, w, h, rx], `dot` a filled
	 * circle [cx, cy, r].
	 */
	type Shape =
		| { p: string }
		| { c: [number, number, number] }
		| { r: [number, number, number, number, number] }
		| { dot: [number, number, number] };

	const ICONS = {
		copy: [
			{ r: [8, 8, 12, 12, 2] },
			{ p: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' }
		],
		check: [{ p: 'M5 12.5l4.5 4.5L19 7' }],
		close: [{ p: 'M6 6l12 12M18 6L6 18' }],
		back: [{ p: 'M15 5l-7 7 7 7' }],
		next: [{ p: 'M9 5l7 7-7 7' }],
		plus: [{ p: 'M12 5v14M5 12h14' }],
		edit: [{ p: 'M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Z' }, { p: 'M13.5 6.5l4 4' }],
		link: [
			{ p: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1' },
			{ p: 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' }
		],
		leave: [
			{ p: 'M3 20h18' },
			{ p: 'M6 20V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15' },
			{ p: 'M6 4l7 2.5V20' },
			{ dot: [11, 13, 1.1] }
		],
		'log out': [
			{ p: 'M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8' },
			{ p: 'M10 12h10M17 8.5l3.5 3.5-3.5 3.5' }
		],
		player: [{ c: [12, 8, 4] }, { p: 'M4 20a8 8 0 0 1 16 0' }],
		players: [
			{ c: [9, 8, 3.5] },
			{ p: 'M2.5 20a6.5 6.5 0 0 1 13 0' },
			{ p: 'M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6' }
		],
		kick: [{ c: [9, 8, 4] }, { p: 'M2 20a7 7 0 0 1 14 0' }, { p: 'M17 7l4 4M21 7l-4 4' }],
		bot: [
			{ r: [4.5, 7.5, 15, 12, 3] },
			{ p: 'M12 3.5v4M2 12v3.5M22 12v3.5' },
			{ dot: [9.5, 13, 1.3] },
			{ dot: [14.5, 13, 1.3] }
		],
		host: [{ p: 'M4 18L3 8l5 4 4-7 4 7 5-4-1 10Z' }, { p: 'M4 21h16' }],
		vip: [
			{ p: 'M7 4h10l4 5-9 11L3 9l4-5Z' },
			{ p: 'M3 9h18M9.5 9L12 20l2.5-11M10 4l-.5 5M14 4l.5 5' }
		],
		away: [{ p: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z' }],
		life: [
			{ p: 'M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 8 2.2C20 15.4 12 20 12 20Z' }
		],
		timer: [{ c: [12, 13.5, 7.5] }, { p: 'M12 13.5V10M9.5 2.5h5M12 2.5V6M18.5 6.5l1.5-1.5' }],
		history: [{ p: 'M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5' }, { p: 'M3.5 4v4.5H8M12 8v4.5l3 2' }],
		'fair play': [
			{ p: 'M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6L12 3Z' },
			{ p: 'M8.5 12l2.5 2.5 4.5-5' }
		],
		seed: [{ p: 'M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16' }],
		coins: [
			{ p: 'M5 7c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 8.4 5 7Z' },
			{ p: 'M5 7v10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V7M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5' }
		],
		trophy: [
			{ p: 'M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4Z' },
			{
				p: 'M7.5 6H4.5a3 3 0 0 0 3.5 4M16.5 6h3a3 3 0 0 1-3.5 4M12 13.5V17M8 20.5h8M9.5 17h5v3.5h-5Z'
			}
		],
		bracket: [{ p: 'M3 5h6v6H3M9 8h5M3 13h6v6H3M9 16h5M14 8v8M14 12h7' }],
		table: [{ r: [3, 8, 18, 8, 4] }, { p: 'M7 4.5h3.5M13.5 4.5H17M7 19.5h3.5M13.5 19.5H17' }],
		cards: [
			{ r: [4, 7, 11, 14, 2] },
			{ p: 'M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3' }
		],
		swap: [{ p: 'M4 8h15M15.5 4.5L19 8l-3.5 3.5M20 16H5M8.5 12.5L5 16l3.5 3.5' }],
		skip: [{ c: [12, 12, 8.5] }, { p: 'M10 9v6M14 9v6' }],
		private: [{ r: [5, 10.5, 14, 10, 2] }, { p: 'M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2' }],
		public: [
			{ c: [12, 12, 8.5] },
			{
				p: 'M3.5 12h17M12 3.5c2.4 2.4 3.5 5.4 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.4-3.5-8.5s1.1-6.1 3.5-8.5Z'
			}
		],
		'how to play': [
			{
				p: 'M12 6.5C10 5 7 4.5 3.5 5v13.5c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5Z'
			},
			{ p: 'M12 6.5V20' }
		]
	} satisfies Record<string, Shape[]>;

	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, class: cls = 'size-5' }: { name: IconName; class?: string } = $props();

	const shapes: Shape[] = $derived(ICONS[name]);
</script>

<svg
	viewBox="0 0 24 24"
	class={cls}
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each shapes as shape, index (index)}
		{#if 'p' in shape}
			<path d={shape.p} />
		{:else if 'c' in shape}
			<circle cx={shape.c[0]} cy={shape.c[1]} r={shape.c[2]} />
		{:else if 'r' in shape}
			<rect x={shape.r[0]} y={shape.r[1]} width={shape.r[2]} height={shape.r[3]} rx={shape.r[4]} />
		{:else}
			<circle
				cx={shape.dot[0]}
				cy={shape.dot[1]}
				r={shape.dot[2]}
				fill="currentColor"
				stroke="none"
			/>
		{/if}
	{/each}
</svg>
