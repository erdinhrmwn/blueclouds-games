<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** How often the list reloads by itself while the tab is visible. */
	const REFRESH_MS = 15_000;

	const PHASES = {
		lobby: { label: 'Waiting', tag: 'tag' },
		playing: { label: 'Playing', tag: 'tag-good' },
		finished: { label: 'Finished', tag: 'tag bg-subtle text-muted' }
	} as const;

	const KINDS = [
		{ value: '', label: 'All' },
		{ value: 'open', label: 'Open' },
		{ value: 'tournament', label: 'Tournament' }
	] as const;

	let game = $state('');
	let kind = $state<'' | 'open' | 'tournament'>('');
	let refreshing = $state(false);
	let now = $state(Date.now());

	const tables = $derived(
		data.tables.filter((table) => {
			const gameFits = !game || table.game === game;
			const kindFits = !kind || table.kind === kind;

			return gameFits && kindFits;
		})
	);

	const stats = $derived([
		{ label: 'Live tables', value: data.tables.length },
		{
			label: 'Playing now',
			value: data.tables.filter((table) => table.phase === 'playing').length
		},
		{
			label: 'Players seated',
			value: data.tables.reduce((sum, table) => sum + table.players, 0)
		},
		{
			label: 'Tournament tables',
			value: data.tables.filter((table) => table.kind === 'tournament').length
		}
	]);

	const updated = $derived.by(() => {
		const seconds = Math.max(0, Math.round((now - new Date(data.checkedAt).getTime()) / 1000));
		if (seconds < 5) return 'Updated just now';
		if (seconds < 60) return `Updated ${seconds}s ago`;

		return `Updated ${Math.floor(seconds / 60)} min ago`;
	});

	const refresh = async () => {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	};

	// Reload every REFRESH_MS while the tab is visible, and tick the "Updated" label every second.
	$effect(() => {
		const reload = setInterval(() => {
			if (document.visibilityState === 'visible' && !refreshing) {
				refresh();
			}
		}, REFRESH_MS);
		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);

		return () => {
			clearInterval(reload);
			clearInterval(tick);
		};
	});
</script>

<svelte:head><title>Live tables · Backoffice</title></svelte:head>

<PageHeader
	title="Live tables"
	description="Open and tournament tables right now. Private tables don't report to the public list, so they aren't here."
>
	{#snippet actions()}
		<span class="self-center text-sm text-muted" aria-live="polite">{updated}</span>
		<button class="btn-quiet" onclick={refresh} disabled={refreshing}>
			{refreshing ? 'Refreshing…' : 'Refresh'}
		</button>
	{/snippet}
</PageHeader>

<dl class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
	{#each stats as stat (stat.label)}
		<div class="panel p-4 sm:p-5">
			<dt class="text-sm font-medium text-muted">{stat.label}</dt>
			<dd class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{stat.value}</dd>
		</div>
	{/each}
</dl>

{#if data.unreachable.length}
	<p class="panel mt-6 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
		The game engine didn't answer for {data.unreachable.join(' and ')}, so its open tables are
		missing. Check that it's running, then refresh.
	</p>
{/if}

<section class="panel mt-6" aria-labelledby="tables">
	<div class="panel-head">
		<h2 id="tables" class="font-semibold">Tables</h2>
		<div class="flex flex-wrap gap-2">
			<div class="flex rounded-lg border border-line p-0.5" role="group" aria-label="Game">
				{#each [{ slug: '', name: 'All games' }, ...data.games] as option (option.slug)}
					<button
						class="min-h-9 rounded-md px-3 text-sm font-medium text-muted hover:text-ink aria-pressed:bg-felt aria-pressed:text-white"
						aria-pressed={game === option.slug}
						onclick={() => (game = option.slug)}>{option.name}</button
					>
				{/each}
			</div>
			<div class="flex rounded-lg border border-line p-0.5" role="group" aria-label="Kind">
				{#each KINDS as option (option.value)}
					<button
						class="min-h-9 rounded-md px-3 text-sm font-medium text-muted hover:text-ink aria-pressed:bg-felt aria-pressed:text-white"
						aria-pressed={kind === option.value}
						onclick={() => (kind = option.value)}>{option.label}</button
					>
				{/each}
			</div>
		</div>
	</div>

	{#if tables.length === 0}
		<p class="px-5 py-12 text-center text-sm text-muted">
			{data.tables.length ? 'No table fits these filters.' : 'Nobody is at a table right now.'}
		</p>
	{:else}
		<!-- Phones: one card per table -->
		<ul class="divide-y divide-line sm:hidden">
			{#each tables as table (table.code)}
				{@const phase = PHASES[table.phase]}
				<li class="px-5 py-4">
					<div class="flex items-center gap-2">
						<span class="font-mono text-base tracking-wider">{table.code}</span>
						<span class={phase.tag}>{phase.label}</span>
						<span class="ml-auto text-sm text-muted tabular-nums"
							>{table.players} of {table.maxPlayers}</span
						>
					</div>
					<p class="mt-1 text-sm text-muted">
						{table.gameName} ·
						{#if table.tournament}
							<a class="link" href="/tournaments/{table.tournament.id}">{table.tournament.name}</a>
						{:else}
							Open table, host {table.host ?? 'unknown'}
						{/if}
					</p>
					{#if table.seats.length}
						<p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
							{#each table.seats as seat (seat.playerId)}
								<a class="link" href="/players/{seat.playerId}">{seat.name}</a>
							{/each}
						</p>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Wider screens: a table -->
		<div class="hidden overflow-x-auto sm:block">
			<table class="data-table min-w-[48rem]">
				<thead>
					<tr>
						<th>Table</th>
						<th>Game</th>
						<th>Phase</th>
						<th>Seats</th>
						<th>Where from</th>
						<th>Players</th>
					</tr>
				</thead>
				<tbody>
					{#each tables as table (table.code)}
						{@const phase = PHASES[table.phase]}
						<tr>
							<td class="font-mono text-sm tracking-wider">{table.code}</td>
							<td class="whitespace-nowrap">{table.gameName}</td>
							<td><span class={phase.tag}>{phase.label}</span></td>
							<td>
								<span class="flex items-center gap-2">
									<span class="tabular-nums">{table.players}/{table.maxPlayers}</span>
									<span class="h-1.5 w-12 overflow-hidden rounded-full bg-line" aria-hidden="true">
										<span
											class="block h-full rounded-full bg-felt"
											style:width="{(table.players / Math.max(1, table.maxPlayers)) * 100}%"
										></span>
									</span>
								</span>
							</td>
							<td>
								{#if table.tournament}
									<span class="tag mr-1.5">Tournament</span>
									<a class="link" href="/tournaments/{table.tournament.id}"
										>{table.tournament.name}</a
									>
								{:else}
									<span class="tag mr-1.5">Open</span>
									<span class="text-muted">host</span>
									{table.host ?? 'unknown'}
								{/if}
							</td>
							<td>
								{#if table.seats.length}
									<span class="flex flex-wrap gap-x-2.5 gap-y-1">
										{#each table.seats as seat (seat.playerId)}
											<a class="link" href="/players/{seat.playerId}">{seat.name}</a>
										{/each}
									</span>
								{:else}
									<span class="text-muted">–</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
