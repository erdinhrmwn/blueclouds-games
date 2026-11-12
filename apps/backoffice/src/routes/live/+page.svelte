<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let refreshing = $state(false);

	const PHASES = {
		lobby: { label: 'Waiting', tag: 'tag' },
		playing: { label: 'Playing', tag: 'tag-good' },
		finished: { label: 'Finished', tag: 'tag bg-subtle text-muted' }
	} as const;

	const openCount = $derived(data.open.reduce((sum, list) => sum + (list.rooms?.length ?? 0), 0));

	const refresh = async () => {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	};
</script>

<svelte:head><title>Live tables · Backoffice</title></svelte:head>

<PageHeader
	title="Live tables"
	description="Tables open right now. Private tables don't show in the public list, so only open and tournament tables appear here."
>
	{#snippet actions()}
		<button class="btn-quiet" onclick={refresh} disabled={refreshing}>
			{refreshing ? 'Refreshing…' : 'Refresh'}
		</button>
	{/snippet}
</PageHeader>

<p class="-mt-3 mb-6 text-sm text-muted">
	{openCount} open {openCount === 1 ? 'table' : 'tables'} and {data.tournament.length} tournament
	{data.tournament.length === 1 ? 'table' : 'tables'}, as of {utc(data.checkedAt)}.
</p>

<div class="grid gap-6 xl:grid-cols-2">
	{#each data.open as list (list.game)}
		<section class="panel min-w-0 self-start" aria-labelledby="open-{list.game}">
			<div class="panel-head">
				<h2 id="open-{list.game}" class="font-semibold">Open tables · {list.gameName}</h2>
				{#if list.rooms}
					<span class="text-sm text-muted tabular-nums">{list.rooms.length}</span>
				{/if}
			</div>
			{#if list.rooms === null}
				<p class="px-5 py-8 text-sm text-danger" role="alert">
					The game engine didn't answer. Check that it's running, then refresh.
				</p>
			{:else if list.rooms.length === 0}
				<p class="px-5 py-8 text-sm text-muted">Nobody is at an open table.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="data-table min-w-[28rem]">
						<thead>
							<tr>
								<th>Table</th>
								<th>Host</th>
								<th>Seats</th>
								<th>Phase</th>
							</tr>
						</thead>
						<tbody>
							{#each list.rooms as room (room.code)}
								{@const phase = PHASES[room.phase]}
								<tr>
									<td class="font-mono text-xs tracking-wider">{room.code}</td>
									<td>{room.host ?? '–'}</td>
									<td class="tabular-nums">{room.players} of {room.maxPlayers}</td>
									<td><span class={phase.tag}>{phase.label}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/each}
</div>

<section class="mt-8" aria-labelledby="tournament-tables">
	<h2 id="tournament-tables" class="font-semibold">Tournament tables</h2>
	{#if data.tournament.length === 0}
		<p class="mt-2 text-sm text-muted">No tournament table is waiting or playing.</p>
	{:else}
		<div class="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.tournament as table (table.id)}
				<section class="panel p-5" aria-label="Table {table.code}">
					<p class="flex items-baseline justify-between gap-2">
						<span class="font-mono text-lg tracking-[0.15em]">{table.code}</span>
						{#if table.startedAt}
							<span class="tag-good">Playing</span>
						{:else}
							<span class="tag">Waiting</span>
						{/if}
					</p>
					<p class="mt-1 text-sm text-muted">
						{table.gameName} ·
						<a class="link" href="/tournaments/{table.tournamentId}">{table.tournamentName}</a>
					</p>
					{#if table.startedAt}
						<p class="text-sm text-muted">Since {utc(table.startedAt)}</p>
					{/if}
					<ol class="mt-3 space-y-1 border-t border-line pt-3 text-sm">
						{#each table.seats as seat (seat.playerId)}
							<li class="flex gap-2">
								<span class="w-5 text-muted tabular-nums"
									>{seat.seat === null ? '–' : seat.seat + 1}</span
								>
								<a class="link" href="/players/{seat.playerId}">{seat.name}</a>
							</li>
						{:else}
							<li class="text-muted">Nobody seated.</li>
						{/each}
					</ol>
				</section>
			{/each}
		</div>
	{/if}
</section>
