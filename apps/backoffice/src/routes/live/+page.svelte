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

	/**
	 * Where a seat sits around the oval table, in percent of the scene: seat 1 top left, then clockwise like the
	 * game's own table. Names go above the seats on the top half, so they never sit on the felt.
	 */
	const seatPlace = (seat: number, count: number) => {
		const angle = ((-90 - 180 / count + (seat * 360) / count) * Math.PI) / 180;

		return { left: 50 + 40 * Math.cos(angle), top: 50 + 37 * Math.sin(angle) };
	};

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
		<ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each tables as table (table.code)}
				{@const phase = PHASES[table.phase]}
				{@const slots = seatSlots(table.seatCount, table.seats)}
				<li class="panel flex flex-col">
					<div class="flex items-center justify-between gap-3 px-5 pt-4">
						<div class="min-w-0">
							<p class="truncate text-sm">
								<span class="font-medium">{table.gameName}</span> ·
								{#if table.tournament}
									<a class="link" href="/tournaments/{table.tournament.id}"
										>{table.tournament.name}</a
									>
								{:else}
									Open table
								{/if}
							</p>
						</div>
						<span class={phase.tag}>{phase.label}</span>
					</div>

					<!-- The table seen from above: felt in the middle, a round seat for every chair around it. -->
					<div class="relative mx-5 my-4 h-64" role="group" aria-label="Seats at {table.code}">
						<div
							class="absolute inset-x-[22%] inset-y-[28%] grid place-items-center rounded-[50%] border-4 border-felt-deep bg-felt text-center text-white shadow-inner"
						>
							<span class="font-mono text-sm tracking-[0.15em] text-white/90">{table.code}</span>
						</div>

						{#each slots as player, seat (seat)}
							{@const place = seatPlace(seat, slots.length)}
							<div
								class="absolute flex w-20 -translate-x-1/2 -translate-y-1/2 items-center gap-1 {place.top <
								50
									? 'flex-col-reverse'
									: 'flex-col'}"
								style:left="{place.left}%"
								style:top="{place.top}%"
							>
								{#if player}
									<svelte:element
										this={player.playerId ? 'a' : 'span'}
										href={player.playerId ? `/players/${player.playerId}` : undefined}
										class="grid size-11 place-items-center rounded-full text-sm font-semibold uppercase shadow-sm ring-2 ring-surface {player.bot
											? 'bg-line text-muted'
											: 'bg-felt-soft text-felt hover:bg-felt hover:text-white'}"
										title="Seat {seat + 1}: {player.name}{player.bot ? ' (bot)' : ''}"
										>{player.name.slice(0, 1)}</svelte:element
									>
									<span class="max-w-full truncate text-xs font-medium">{player.name}</span>
								{:else}
									<span
										class="grid size-11 place-items-center rounded-full border-2 border-dashed border-line bg-surface text-xs text-muted"
										title="Seat {seat + 1}: empty">{seat + 1}</span
									>
									<span class="text-xs text-muted">Empty</span>
								{/if}
							</div>
						{/each}
					</div>

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
