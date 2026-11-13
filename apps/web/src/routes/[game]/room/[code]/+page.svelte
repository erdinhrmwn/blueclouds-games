<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Table {data.code} · {data.game.name}</title></svelte:head>

<!-- A new code is another table: start its room fresh instead of keeping the last table's connection and state. -->
{#key data.code}
	<data.game.Room game={data.game} code={data.code} />
{/key}
