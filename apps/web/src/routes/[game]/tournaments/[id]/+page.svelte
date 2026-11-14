<script lang="ts">
	import Bracket from '#lib/components/Bracket.svelte';
	import StandingsList from '#lib/components/StandingsList.svelte';
	import { FORMATS, ranFor, ranksByPoints } from '#lib/tournament-formats.ts';
	import type { PageProps } from './$types';

	/** A tournament's own page: its rounds as a bracket, and its standings. */
	let { data }: PageProps = $props();

	const board = $derived(data.board);
	const tournament = $derived(board.tournament);
	const finished = $derived(!!tournament.endedAt);
	const byPoints = $derived(ranksByPoints(tournament.format));
	const format = $derived(tournament.format ? FORMATS[tournament.format] : null);
	const latestRound = $derived(board.rounds.at(-1)?.round ?? 1);

	const status = $derived.by(() => {
		if (tournament.cancelled) {
			return { label: 'Cancelled', dot: 'bg-ember' };
		}

		if (finished) {
			return { label: 'Finished', dot: 'bg-brass' };
		}

		return { label: `Round ${latestRound}`, dot: 'bg-paper' };
	});

	const TABS = [
		{ id: 'bracket', label: 'Bracket' },
		{ id: 'standings', label: 'Standings' }
	] as const;
	let tab = $state<'bracket' | 'standings'>('bracket');
</script>

<svelte:head><title>{tournament.name} · {data.game.name} · BlueClouds Games</title></svelte:head>

<nav class="pt-6 text-sm text-paper/55 md:pt-10" aria-label="Breadcrumb">
	<a class="hover:text-paper" href="/">Games</a>
	<span aria-hidden="true">/</span>
	<a class="hover:text-paper" href="/{data.game.slug}">{data.game.name}</a>
	<span aria-hidden="true">/</span>
	<span class="font-medium text-paper/85" aria-current="page">{tournament.name}</span>
</nav>

<header class="mt-4 flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="font-display text-3xl leading-none font-black sm:text-4xl">{tournament.name}</h1>
		<p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-paper/60">
			<span
				class="inline-flex items-center gap-1.5 rounded-full bg-room/85 px-2.5 py-1 text-xs font-semibold text-paper ring-1 ring-paper/10"
			>
				<span class="size-1.5 rounded-full {status.dot}" aria-hidden="true"></span>
				{status.label}
			</span>
			<!-- The facts as short columns split by hairlines, not one dotted string. -->
			<span class="flex flex-wrap items-center divide-x divide-paper/20">
				<span class="pr-3">{format?.label ?? 'Knockout'}</span>
				<span class="px-3">{tournament.players} players</span>
				<span class="px-3">{latestRound} {latestRound === 1 ? 'round' : 'rounds'}</span>
				{#if finished && tournament.endedAt}
					<span class="pl-3">ran {ranFor(tournament.startsAt, tournament.endedAt)}</span>
				{/if}
			</span>
		</p>
	</div>
	<div class="grid w-full grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 sm:w-64" role="tablist">
		{#each TABS as entry (entry.id)}
			<button
				role="tab"
				aria-selected={tab === entry.id}
				aria-controls="tournament-{entry.id}"
				class="h-9 rounded-lg text-sm font-semibold {tab === entry.id
					? 'bg-paper text-ink'
					: 'text-paper/75 hover:text-paper'}"
				onclick={() => (tab = entry.id)}
			>
				{entry.id === 'bracket' && byPoints ? 'Rounds' : entry.label}
			</button>
		{/each}
	</div>
</header>

<section id="tournament-bracket" class="mt-8 {tab === 'bracket' ? '' : 'hidden'}" role="tabpanel">
	<Bracket {board} myId={board.me?.playerId ?? null} />
</section>

<section
	id="tournament-standings"
	class="mt-8 max-w-2xl {tab === 'standings' ? '' : 'hidden'}"
	role="tabpanel"
>
	{#if board.standings.length === 0}
		<p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
			Standings show once the first tables finish.
		</p>
	{:else}
		<StandingsList
			standings={board.standings}
			{byPoints}
			round={latestRound}
			{finished}
			myId={board.me?.playerId ?? null}
		/>
	{/if}
</section>
