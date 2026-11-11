<script lang="ts">
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const f = $derived(data.filter);
	const filtered = $derived(!!(f.game || f.player || f.from || f.to));
	const nextHref = $derived.by(() => {
		const q = new URLSearchParams(Object.entries({ ...f, before: data.next ?? '' }).filter(([, v]) => v));
		return `?${q}`;
	});
</script>

<svelte:head><title>Matches · Backoffice</title></svelte:head>

<h1 class="text-2xl font-semibold">Matches</h1>

<form method="GET" class="mt-4 grid gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
	<div>
		<label class="label" for="game">Game</label>
		<select class="field" id="game" name="game" value={f.game}>
			<option value="">All games</option>
			{#each data.games as g (g.slug)}<option value={g.slug}>{g.name}</option>{/each}
		</select>
	</div>
	<div>
		<label class="label" for="player">Player id</label>
		<input class="field font-mono text-sm" id="player" name="player" value={f.player} maxlength="36" />
	</div>
	<div>
		<label class="label" for="from">Ended from (UTC)</label>
		<input class="field" id="from" name="from" type="date" value={f.from} />
	</div>
	<div>
		<label class="label" for="to">Ended to (UTC)</label>
		<input class="field" id="to" name="to" type="date" value={f.to} />
	</div>
	<div class="flex gap-2">
		<button class="btn-primary">Filter</button>
		{#if filtered}<a class="btn-quiet" href="/matches">Clear</a>{/if}
	</div>
</form>

{#if data.matches.length === 0}
	<p class="mt-6 text-muted">{filtered ? 'No matches fit these filters.' : f.before ? 'No more matches.' : 'No matches yet.'}</p>
{:else}
	<div class="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
		<table class="w-full min-w-[36rem] text-left text-sm">
			<thead class="border-b border-line text-muted">
				<tr>
					<th class="px-3 py-2 font-medium">Ended</th>
					<th class="px-3 py-2 font-medium">Game</th>
					<th class="px-3 py-2 font-medium">Table</th>
					<th class="px-3 py-2 font-medium">Players</th>
					<th class="px-3 py-2 font-medium">Winner</th>
				</tr>
			</thead>
			<tbody>
				{#each data.matches as m (m.id)}
					<tr class="border-b border-line last:border-0 hover:bg-page">
						<td class="px-3 py-2 whitespace-nowrap">
							<a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/matches/{m.id}">{utc(m.endedAt)}</a>
						</td>
						<td class="px-3 py-2">{m.gameName}</td>
						<td class="px-3 py-2 font-mono text-xs">{m.roomCode}</td>
						<td class="px-3 py-2">{m.players}</td>
						<td class="px-3 py-2">{m.winner ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if data.next}<a class="btn-quiet mt-4" href={nextHref}>Older matches</a>{/if}
{/if}
