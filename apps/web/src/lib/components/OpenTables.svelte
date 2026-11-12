<script lang="ts">
	import { RoomList } from '#lib/rooms.svelte.ts';
	import { enterTable } from '#lib/tables.ts';
	import { onMount } from 'svelte';

	/** A game's open tables, refreshed every few seconds. */
	let { game }: { game: string } = $props();
	let list = $state<RoomList | null>(null);

	const phaseLabel = (phase: string, open: boolean) => {
		if (phase === 'playing') return 'Playing';
		if (phase === 'finished') return 'Finished';
		return open ? 'In lobby' : 'Full';
	};

	onMount(() => {
		const rooms = new RoomList(game);
		list = rooms;
		return () => rooms.dispose();
	});
</script>

<section class="mt-16" aria-labelledby="tables-title">
	<h2 id="tables-title" class="font-display text-2xl font-bold">Open tables</h2>
	{#if !list || list.status === 'loading'}
		<p class="mt-3 text-paper/75" aria-live="polite">Looking for tables…</p>
	{:else if list.status === 'error'}
		<p class="mt-3 text-paper/75">
			Could not load the tables. You can still join with an invite code.
		</p>
	{:else if list.rooms.length === 0}
		<p class="mt-3 text-paper/75">No public tables right now. Open one and invite friends.</p>
	{:else}
		<ul class="mt-4 divide-y divide-paper/10 rounded-xl border border-paper/15 bg-[#1b1611]">
			{#each list.rooms as r (r.code)}
				{@const open = r.phase === 'lobby' && r.players < r.maxPlayers}
				<li class="flex items-center gap-4 px-4 py-3">
					<span class="font-mono text-lg tracking-[0.15em] text-brass">{r.code}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{r.host ? `${r.host}’s table` : 'Table'}</span>
						<span class="block text-sm text-paper/75">
							{r.players}/{r.maxPlayers} players ·
							{phaseLabel(r.phase, open)}
						</span>
					</span>
					<button
						class="btn-ghost shrink-0"
						onclick={() => enterTable(game, r.code)}
						disabled={!open}
						aria-label="Join table {r.code}"
					>
						Join
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
