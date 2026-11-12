<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { seatSlots } from '#lib/seat-slots.ts';
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

<section class="mt-8" aria-labelledby="tables">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h2 id="tables" class="font-semibold">
			Tables <span class="font-normal text-muted tabular-nums">({tables.length})</span>
		</h2>
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
		<p class="panel px-5 py-12 text-center text-sm text-muted">
			{data.tables.length ? 'No table fits these filters.' : 'Nobody is at a table right now.'}
		</p>
	{:else}
		<ul class="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
			{#each tables as table (table.code)}
				{@const phase = PHASES[table.phase]}
				{@const slots = seatSlots(table.seatCount, table.seats)}
				<li class="panel flex flex-col">
					<div class="flex items-start justify-between gap-3 px-5 pt-4">
						<div class="min-w-0">
							<p class="font-mono text-lg tracking-[0.15em]">{table.code}</p>
							<p class="mt-0.5 truncate text-sm text-muted">
								{table.gameName} ·
								{#if table.tournament}
									<a class="link" href="/tournaments/{table.tournament.id}"
										>{table.tournament.name}</a
									>
								{:else}
									Open table
								{/if}
							</p>
						</div>
						<span class="{phase.tag} mt-1">{phase.label}</span>
					</div>

					<ol
						class="grid grid-cols-2 gap-2 px-5 py-4 sm:grid-cols-3"
						aria-label="Seats at {table.code}"
					>
						{#each slots as player, seat (seat)}
							<li>
								{#if player}
									<div
										class="flex h-full min-h-14 items-center gap-2 rounded-lg border border-line bg-subtle px-2.5 py-2"
									>
										<span
											class="grid size-8 shrink-0 place-items-center rounded-md text-xs font-semibold uppercase {player.bot
												? 'bg-line text-muted'
												: 'bg-felt-soft text-felt'}"
											aria-hidden="true">{player.name.slice(0, 1)}</span
										>
										<span class="min-w-0 text-sm leading-tight">
											<span class="block text-[0.6875rem] text-muted">Seat {seat + 1}</span>
											{#if player.playerId}
												<a class="link block truncate font-medium" href="/players/{player.playerId}"
													>{player.name}</a
												>
											{:else}
												<span class="block truncate font-medium">{player.name}</span>
											{/if}
											{#if player.bot}<span class="sr-only">(bot)</span>{/if}
										</span>
									</div>
								{:else}
									<div
										class="flex h-full min-h-14 items-center rounded-lg border border-dashed border-line px-2.5 py-2 text-sm text-muted"
									>
										<span class="leading-tight">
											<span class="block text-[0.6875rem]">Seat {seat + 1}</span>
											Empty
										</span>
									</div>
								{/if}
							</li>
						{/each}
					</ol>

					<div class="mt-auto flex items-center gap-3 border-t border-line px-5 py-3 text-sm">
						<span class="tabular-nums">{table.players} of {table.seatCount} seats taken</span>
						<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
							<span
								class="block h-full rounded-full bg-felt"
								style:width="{(table.players / Math.max(1, table.seatCount)) * 100}%"
							></span>
						</span>
						{#if !table.tournament}
							<span class="truncate text-muted">Host {table.host ?? 'unknown'}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
