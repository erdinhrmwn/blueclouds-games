<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.game.name} · BlueClouds Games</title></svelte:head>

<data.game.Home game={data.game} />
