<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import RoomFrame from '#lib/components/RoomFrame.svelte';
	import { CloudburstConnection } from './connection.svelte.ts';
	import Table from './Table.svelte';

	let { game, code }: { game: GameEntry; code: string } = $props();
</script>

<RoomFrame {game} {code} connect={() => new CloudburstConnection(code)}>
	{#snippet table(room)}<Table {room} />{/snippet}
</RoomFrame>
