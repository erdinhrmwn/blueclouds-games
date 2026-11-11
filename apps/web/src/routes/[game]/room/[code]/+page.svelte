<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Table {data.code} · {data.game.name}</title></svelte:head>

<data.game.Room game={data.game} code={data.code} />
