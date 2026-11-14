<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const filter = $derived(data.filter);
	const filtered = $derived(!!(filter.game || filter.player || filter.from || filter.to));
	const emptyText = $derived.by(() => {
		if (filtered) {
			return 'No matches fit these filters.';
		}

		if (filter.before) {
			return 'No more matches.';
		}

		return 'No matches yet.';
	});
	const nextHref = $derived.by(() => {
		const fields = Object.entries({ ...filter, before: data.next ?? '' });
		const params = new URLSearchParams(fields.filter(([, value]) => value));

		return `?${params}`;
	});
</script>

<svelte:head><title>Matches · Backoffice</title></svelte:head>

<PageHeader
	title="Matches"
	description="Finished matches, newest first. Open one to replay it move by move."
/>

<section class="panel" aria-label="Match list">
	<form
		method="GET"
		class="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
	>
		<div>
			<label class="label" for="game">Game</label>
			<select class="field" id="game" name="game" value={filter.game}>
				<option value="">All games</option>
				{#each data.games as game (game.slug)}<option value={game.slug}>{game.name}</option>{/each}
			</select>
		</div>
		<div>
			<label class="label" for="player">Player id</label>
			<input
				class="field font-mono text-sm"
				id="player"
				name="player"
				value={filter.player}
				maxlength="36"
			/>
		</div>
		<div>
			<label class="label" for="from">Ended from (UTC)</label>
			<input class="field" id="from" name="from" type="date" value={filter.from} />
		</div>
		<div>
			<label class="label" for="to">Ended to (UTC)</label>
			<input class="field" id="to" name="to" type="date" value={filter.to} />
		</div>
		<div class="flex gap-2 sm:col-span-2 lg:col-span-1">
			<button class="btn-primary">Filter</button>
			{#if filtered}<a class="btn-quiet" href="/matches">Clear</a>{/if}
		</div>
	</form>

	{#if data.matches.length === 0}
		<p class="px-5 py-10 text-center text-sm text-muted">{emptyText}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="data-table min-w-[36rem]">
				<thead>
					<tr>
						<th>Ended</th>
						<th>Game</th>
						<th>Table</th>
						<th>Players</th>
						<th>Winner</th>
					</tr>
				</thead>
				<tbody>
					{#each data.matches as match (match.id)}
						<tr>
							<td class="whitespace-nowrap">
								<a class="link" href="/matches/{match.id}">{utc(match.endedAt)}</a>
							</td>
							<td>{match.gameName}</td>
							<td class="font-mono text-xs">{match.roomCode}</td>
							<td class="tabular-nums">{match.players}</td>
							<td>
								{#if match.endReason === 'terminated'}
									<span class="tag-bad">Terminated</span>
								{:else}
									{match.winner ?? ''}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

{#if data.next}<a class="btn-quiet mt-4" href={nextHref}>Older matches</a>{/if}
