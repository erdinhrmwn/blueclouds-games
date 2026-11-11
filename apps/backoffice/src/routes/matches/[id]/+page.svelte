<script lang="ts">
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	// What each game's per-seat score means. Unknown games just say "Score".
	const SCORE_LABEL = new Map([['bust-31', 'Lives left']]);

	let { data }: PageProps = $props();
	const m = $derived(data.match);
	const minutes = $derived(Math.max(1, Math.round((new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 60_000)));
</script>

<svelte:head><title>Match {m.roomCode} · Backoffice</title></svelte:head>

<a href="/matches" class="text-sm text-muted underline-offset-2 hover:underline">Matches</a>
<h1 class="mt-1 text-2xl font-semibold">{m.game} at table {m.roomCode}</h1>

<dl class="mt-4 grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
	<dt class="text-muted">Match id</dt>
	<dd class="font-mono text-xs leading-5 break-all">{m.id}</dd>
	<dt class="text-muted">Played</dt>
	<dd>{utc(m.startedAt)}, {minutes} min</dd>
	<dt class="text-muted">Rules version</dt>
	<dd>{m.rulesVersion}</dd>
</dl>

<div class="mt-6 max-w-2xl overflow-x-auto rounded-lg border border-line bg-surface">
	<table class="w-full min-w-[28rem] text-left text-sm">
		<thead class="border-b border-line text-muted">
			<tr>
				<th class="px-3 py-2 font-medium">Place</th>
				<th class="px-3 py-2 font-medium">Player</th>
				<th class="px-3 py-2 font-medium">Seat</th>
				<th class="px-3 py-2 font-medium">{SCORE_LABEL.get(m.game) ?? 'Score'}</th>
			</tr>
		</thead>
		<tbody>
			{#each m.seats as s (s.seat)}
				<tr class="border-b border-line last:border-0">
					<td class="px-3 py-2 font-semibold {s.placement === 1 ? 'text-felt' : ''}">{s.placement}</td>
					<td class="px-3 py-2">
						{#if s.playerId}
							<a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/players/{s.playerId}">{s.name}</a>
						{:else}
							{s.name} <span class="text-muted">(bot)</span>
						{/if}
					</td>
					<td class="px-3 py-2">{s.seat + 1}</td>
					<td class="px-3 py-2">{s.score}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
