<script lang="ts">
	import MatchReplay from '#lib/components/MatchReplay.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import { replay } from '#lib/replay.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const match = $derived(data.match);
	const minutes = $derived.by(() => {
		const playedMs = new Date(match.endedAt).getTime() - new Date(match.startedAt).getTime();
		return Math.max(1, Math.round(playedMs / 60_000));
	});

	const steps = $derived(data.log ? replay(match.game, data.log, match.seats) : []);
	const flagged = $derived(steps.filter((s) => s.mismatch).length);

	const terminated = $derived(match.endReason === 'terminated');
	/** Why an admin stopped the match, from its last log event. */
	const terminatedReason = $derived.by(() => {
		const event = data.log?.events.findLast((e) => e.type === 'terminated');
		const reason = event?.data?.reason;

		return typeof reason === 'string' ? reason : null;
	});

	const nameOf = (seat: number) =>
		match.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;
</script>

<svelte:head><title>Match {match.roomCode} · Backoffice</title></svelte:head>

<PageHeader
	title="{match.gameName} at table {match.roomCode}"
	parent={{ href: '/matches', label: 'Matches' }}
>
	{#snippet actions()}
		{#if data.log}
			<a class="btn-quiet" href="/matches/{match.id}/log.json" download>Download JSON</a>
		{/if}
	{/snippet}
</PageHeader>

<div class="grid gap-6 lg:grid-cols-2">
	<section class="panel" aria-labelledby="details">
		<div class="panel-head">
			<h2 id="details" class="font-semibold">Details</h2>
		</div>
		<dl class="facts">
			<dt>Table</dt>
			<dd>
				<span class="font-mono">{match.roomCode}</span>, {match.tournamentId
					? 'tournament table'
					: 'open table'}
			</dd>
			{#if match.tournamentId}
				<dt>Tournament</dt>
				<dd>
					<a class="link" href="/tournaments/{match.tournamentId}">{match.tournamentName}</a>
				</dd>
			{:else}
				<dt>Opened by</dt>
				<dd>
					{#if match.openedByPlayerId}
						<a class="link" href="/players/{match.openedByPlayerId}">{match.openedByPlayer}</a>
					{:else if match.openedByAdmin}
						{match.openedByAdmin} <span class="text-muted">(admin)</span>
					{:else}
						<span class="text-muted">Not recorded</span>
					{/if}
				</dd>
			{/if}
			<dt>Match id</dt>
			<dd class="font-mono text-xs leading-5 break-all">{match.id}</dd>
			<dt>Played</dt>
			<dd>{utc(match.startedAt)}, {minutes} min</dd>
			<dt>Ended</dt>
			<dd>
				{#if terminated}
					<span class="tag-bad">Terminated by an admin</span>
					{#if terminatedReason}<span class="mt-1 block text-sm">{terminatedReason}</span>{/if}
				{:else}
					Played to the end
				{/if}
			</dd>
			<dt>Rules version</dt>
			<dd>{match.rulesVersion}</dd>
			<dt>Fairness</dt>
			<dd>
				{#if !data.fairness}
					<span class="text-muted">Not recorded. Played before provably fair shuffles.</span>
				{:else if data.fairness.ok}
					<span class="tag-good">
						Verified, {data.fairness.shuffles}
						{data.fairness.shuffles === 1 ? 'shuffle' : 'shuffles'}
					</span>
				{:else if data.fairness.failed.length}
					<span class="tag-bad">
						{data.fairness.failed.length === 1 ? 'Shuffle' : 'Shuffles'}
						{data.fairness.failed.join(', ')} do not match the seeds
					</span>
				{:else}
					<span class="tag-bad">The log's seeds do not match the stored ones</span>
				{/if}
			</dd>
			{#if match.serverSeed}
				<dt>Server seed hash</dt>
				<dd class="font-mono text-xs leading-5 break-all">{match.serverSeedHash}</dd>
				<dt>Server seed</dt>
				<dd class="font-mono text-xs leading-5 break-all">{match.serverSeed}</dd>
				<dt>Client seed</dt>
				<dd class="font-mono text-xs leading-5 break-all">{match.clientSeed}</dd>
			{/if}
		</dl>
	</section>

	<section class="panel min-w-0 self-start" aria-labelledby="result">
		<div class="panel-head">
			<h2 id="result" class="font-semibold">Result</h2>
			{#if terminated}
				<p class="mt-0.5 text-sm text-muted">Standings when it was terminated. No win counted.</p>
			{/if}
		</div>
		<div class="overflow-x-auto">
			<table class="data-table min-w-[24rem]">
				<thead>
					<tr>
						<th>Place</th>
						<th>Player</th>
						<th>Seat</th>
						<th>{match.scoreLabel}</th>
					</tr>
				</thead>
				<tbody>
					{#each match.seats as seat (seat.seat)}
						<tr>
							<td
								class="font-semibold tabular-nums {seat.placement === 1 && !terminated
									? 'text-felt'
									: ''}">{seat.placement}</td
							>
							<td>
								{#if seat.playerId}
									<a class="link" href="/players/{seat.playerId}">{seat.name}</a>
								{:else}
									{seat.name} <span class="tag bg-subtle text-muted">Bot</span>
								{/if}
							</td>
							<td class="tabular-nums">{seat.seat + 1}</td>
							<td class="tabular-nums">{seat.score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>

<section class="panel mt-6" aria-labelledby="moves">
	<div class="panel-head">
		<h2 id="moves" class="font-semibold">Replay</h2>
		{#if steps.length}
			<p class="text-sm {flagged ? 'font-semibold text-danger' : 'text-muted'}">
				{steps.length} events.
				{flagged
					? `${flagged} ${flagged === 1 ? 'step disagrees' : 'steps disagree'} with what the server logged.`
					: 'The replay matches the server on every step.'}
			</p>
		{/if}
	</div>

	<div class="px-5 py-5">
		{#if steps.length === 0}
			<p class="text-sm text-muted">
				No move log for this match. It was played before moves were recorded.
			</p>
		{:else}
			<MatchReplay {steps} {nameOf} />
		{/if}
	</div>
</section>
