<script lang="ts">
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

	let at = $state(0);
	const step = $derived(steps[Math.min(at, steps.length - 1)]);

	const nameOf = (seat: number) =>
		match.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;

	/** "+3:07": minutes and seconds since the match started. */
	const clock = (ms: number) => {
		const minutes = Math.floor(ms / 60_000);
		const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
		return `+${minutes}:${seconds}`;
	};

	let timeline = $state<HTMLOListElement>();
	$effect(() => {
		timeline?.querySelector(`[data-step="${at}"]`)?.scrollIntoView({ block: 'nearest' });
	});
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
			<dt>Rules version</dt>
			<dd>{match.rulesVersion}</dd>
		</dl>
	</section>

	<section class="panel min-w-0 self-start" aria-labelledby="result">
		<div class="panel-head">
			<h2 id="result" class="font-semibold">Result</h2>
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
							<td class="font-semibold tabular-nums {seat.placement === 1 ? 'text-felt' : ''}"
								>{seat.placement}</td
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
		<h2 id="moves" class="font-semibold">Moves</h2>
		{#if step}
			<p class="text-sm {flagged ? 'font-semibold text-danger' : 'text-muted'}">
				{steps.length} events.
				{flagged
					? `${flagged} ${flagged === 1 ? 'step disagrees' : 'steps disagree'} with what the server logged.`
					: 'The replay matches the server on every step.'}
			</p>
		{/if}
	</div>

	<div class="px-5 py-5">
		{#if !step}
			<p class="text-sm text-muted">
				No move log for this match. It was played before moves were recorded.
			</p>
		{:else}
			<div class="flex flex-wrap items-center gap-3">
				<button class="btn-quiet" onclick={() => (at = Math.max(0, at - 1))} disabled={at === 0}
					>Previous</button
				>
				<label
					class="order-first flex basis-full items-center gap-3 text-sm sm:order-none sm:basis-0 sm:flex-1"
				>
					<span class="shrink-0 tabular-nums">Step {at + 1} of {steps.length}</span>
					<input
						class="h-11 w-full accent-felt"
						type="range"
						min="0"
						max={steps.length - 1}
						bind:value={at}
					/>
				</label>
				<button
					class="btn-quiet"
					onclick={() => (at = Math.min(steps.length - 1, at + 1))}
					disabled={at === steps.length - 1}>Next</button
				>
			</div>

			<div class="mt-4 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
				<div
					class="self-start rounded-lg border border-line bg-subtle p-4 lg:sticky lg:top-20"
					aria-live="polite"
				>
					<p class="text-sm">{step.text}</p>
					{#if step.mismatch}<p class="mt-2 text-sm font-semibold text-danger">
							Check: {step.mismatch}
						</p>{/if}
					{#if step.state}
						{@const t = step.state}
						<dl
							class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm"
						>
							<dt class="text-muted">Round</dt>
							<dd>{t.round}</dd>
							<dt class="text-muted">Total</dt>
							<dd class="font-semibold tabular-nums">{t.total} of {t.limit}</dd>
							<dt class="text-muted">Direction</dt>
							<dd>{t.clockwise ? 'Clockwise' : 'Counter-clockwise'}</dd>
							<dt class="text-muted">Pile</dt>
							<dd>{t.pileTop ?? 'Empty'}</dd>
							<dt class="text-muted">Deck</dt>
							<dd>{t.deckCount} cards</dd>
						</dl>
						<ul class="mt-3 divide-y divide-line border-t border-line">
							{#each t.seats as s (s.seat)}
								<li class="py-2 text-sm {s.lives === 0 ? 'text-muted' : ''}">
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-medium">{nameOf(s.seat)}</span>
										{#if t.turnSeat === s.seat}<span
												class="tag border-felt bg-felt font-semibold text-white">Turn</span
											>{/if}
										{#if s.away}<span class="tag">Away</span>{/if}
										<span class="ml-auto tabular-nums"
											>{s.lives === 0
												? 'Out'
												: `${s.lives} ${s.lives === 1 ? 'life' : 'lives'}`}</span
										>
									</div>
									{#if s.hand.length}
										<ul class="mt-1 flex flex-wrap gap-1" aria-label="Hand of {nameOf(s.seat)}">
											{#each s.hand as card, i (i)}
												<li
													class="min-w-8 rounded border border-line bg-surface px-1.5 text-center font-mono text-xs leading-6"
												>
													{card}
												</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<ol
					bind:this={timeline}
					class="max-h-[36rem] overflow-y-auto rounded-lg border border-line"
					aria-label="Timeline"
				>
					{#each steps as s, i (s.event.seq)}
						<li class="border-b border-line last:border-0">
							<button
								data-step={i}
								aria-current={i === at ? 'step' : undefined}
								class="grid min-h-11 w-full grid-cols-[3rem_4rem_1fr] items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-subtle aria-[current=step]:bg-felt-soft aria-[current=step]:font-semibold"
								onclick={() => (at = i)}
							>
								<span class="text-muted tabular-nums">{s.event.seq + 1}</span>
								<span class="text-muted tabular-nums">{clock(s.event.t)}</span>
								<span>
									{s.text}
									{#if s.mismatch}<span class="ml-1 font-semibold text-danger">Check</span>{/if}
								</span>
							</button>
						</li>
					{/each}
				</ol>
			</div>
		{/if}
	</div>
</section>
