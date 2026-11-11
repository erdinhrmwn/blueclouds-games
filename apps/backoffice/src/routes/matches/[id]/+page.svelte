<script lang="ts">
	import { utc } from '#lib/format.ts';
	import { replay } from '#lib/replay.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(data.match);
	const minutes = $derived(Math.max(1, Math.round((new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 60_000)));

	const steps = $derived(data.log ? replay(m.game, data.log, m.seats) : []);
	const flagged = $derived(steps.filter((s) => s.mismatch).length);
	let at = $state(0);
	const step = $derived(steps[Math.min(at, steps.length - 1)]);
	const nameOf = (seat: number) => m.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;
	const clock = (ms: number) => `+${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

	let timeline = $state<HTMLOListElement>();
	$effect(() => {
		timeline?.querySelector(`[data-step="${at}"]`)?.scrollIntoView({ block: 'nearest' });
	});
</script>

<svelte:head><title>Match {m.roomCode} · Backoffice</title></svelte:head>

<a href="/matches" class="text-sm text-muted underline-offset-2 hover:underline">Matches</a>
<h1 class="mt-1 text-2xl font-semibold">{m.gameName} at table {m.roomCode}</h1>

<dl class="mt-4 grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
	<dt class="text-muted">Table</dt>
	<dd><span class="font-mono">{m.roomCode}</span>, {m.tournamentId ? 'tournament table' : 'open table'}</dd>
	{#if m.tournamentId}
		<dt class="text-muted">Tournament</dt>
		<dd><a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/tournaments/{m.tournamentId}">{m.tournamentName}</a></dd>
	{:else}
		<dt class="text-muted">Opened by</dt>
		<dd>
			{#if m.openedByPlayerId}
				<a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/players/{m.openedByPlayerId}">{m.openedByPlayer}</a>
			{:else if m.openedByAdmin}
				{m.openedByAdmin} <span class="text-muted">(admin)</span>
			{:else}
				<span class="text-muted">Not recorded</span>
			{/if}
		</dd>
	{/if}
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
				<th class="px-3 py-2 font-medium">{m.scoreLabel}</th>
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

<section class="mt-10" aria-labelledby="moves">
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
		<h2 id="moves" class="text-xl font-semibold">Moves</h2>
		{#if data.log}
			<a class="text-sm underline decoration-line underline-offset-2 hover:decoration-ink" href="/matches/{m.id}/log.json" download>Download JSON</a>
		{/if}
	</div>

	{#if !step}
		<p class="mt-2 text-muted">No move log for this match. It was played before moves were recorded.</p>
	{:else}
		<p class="mt-1 text-sm {flagged ? 'font-semibold text-danger' : 'text-muted'}">
			{steps.length} events.
			{flagged ? `${flagged} ${flagged === 1 ? 'step disagrees' : 'steps disagree'} with what the server logged.` : 'The replay matches the server on every step.'}
		</p>

		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button class="btn-quiet" onclick={() => (at = Math.max(0, at - 1))} disabled={at === 0}>Previous</button>
			<label class="order-first flex basis-full items-center gap-3 text-sm sm:order-none sm:basis-0 sm:flex-1">
				<span class="shrink-0 tabular-nums">Step {at + 1} of {steps.length}</span>
				<input class="h-11 w-full accent-felt" type="range" min="0" max={steps.length - 1} bind:value={at} />
			</label>
			<button class="btn-quiet" onclick={() => (at = Math.min(steps.length - 1, at + 1))} disabled={at === steps.length - 1}>Next</button>
		</div>

		<div class="mt-4 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
			<div class="self-start rounded-lg border border-line bg-surface p-4 lg:sticky lg:top-4" aria-live="polite">
				<p class="text-sm">{step.text}</p>
				{#if step.mismatch}<p class="mt-2 text-sm font-semibold text-danger">Check: {step.mismatch}</p>{/if}
				{#if step.state}
					{@const t = step.state}
					<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
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
									{#if t.turnSeat === s.seat}<span class="rounded bg-felt px-1.5 text-xs font-semibold text-white">Turn</span>{/if}
									{#if s.away}<span class="rounded border border-line px-1.5 text-xs">Away</span>{/if}
									<span class="ml-auto tabular-nums">{s.lives === 0 ? 'Out' : `${s.lives} ${s.lives === 1 ? 'life' : 'lives'}`}</span>
								</div>
								{#if s.hand.length}
									<ul class="mt-1 flex flex-wrap gap-1" aria-label="Hand of {nameOf(s.seat)}">
										{#each s.hand as card, i (i)}
											<li class="min-w-8 rounded border border-line bg-page px-1.5 text-center font-mono text-xs leading-6">{card}</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<ol bind:this={timeline} class="max-h-[36rem] overflow-y-auto rounded-lg border border-line bg-surface" aria-label="Timeline">
				{#each steps as s, i (s.event.seq)}
					<li class="border-b border-line last:border-0">
						<button
							data-step={i}
							aria-current={i === at ? 'step' : undefined}
							class="grid min-h-11 w-full grid-cols-[3rem_4rem_1fr] items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-page aria-[current=step]:bg-page aria-[current=step]:font-semibold"
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
</section>
