<script lang="ts">
	import { STAGE, stage } from '#lib/stage.svelte.ts';
	import type { Snippet } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	/**
	 * Shows the table on a fixed-size stage scaled to fit the window, so every screen of the same shape sees the same
	 * picture: 16:9 on a landscape window, 1:2 on a portrait one, with the room's colour around it.
	 * Inside, `wide:` and `tall:` style for the stage in use (`sm:` would follow the window, not the stage).
	 */
	let { children }: { children: Snippet } = $props();

	const measured = $derived(innerWidth.current !== undefined && innerHeight.current !== undefined);
	const windowWidth = $derived(innerWidth.current ?? STAGE.wide.width);
	const windowHeight = $derived(innerHeight.current ?? STAGE.wide.height);

	const wide = $derived(windowWidth >= windowHeight);
	const size = $derived(wide ? STAGE.wide : STAGE.tall);
	const scale = $derived(Math.min(windowWidth / size.width, windowHeight / size.height));

	$effect(() => {
		stage.wide = wide;
		stage.scale = scale;
	});

	$effect(() => {
		return () => {
			stage.wide = true;
			stage.scale = 1;
		};
	});
</script>

<div class="fixed inset-0 overflow-hidden" class:invisible={!measured}>
	<div
		class="absolute top-1/2 left-1/2 flex flex-col px-4 pb-3 wide:px-6 wide:pb-4"
		data-stage={wide ? 'wide' : 'tall'}
		style="width: {size.width}px; height: {size.height}px; transform: translate(-50%, -50%) scale({scale});"
	>
		{@render children()}
	</div>
</div>
