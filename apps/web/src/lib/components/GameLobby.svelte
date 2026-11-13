<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import type { Snippet } from 'svelte';
	import OpenTableDialog from './OpenTableDialog.svelte';
	import OpenTables from './OpenTables.svelte';
	import TableCodeJoin from './TableCodeJoin.svelte';
	import Tournaments from './Tournaments.svelte';

	/**
	 * A game's own page, the same for every game: the game, open or join a table, its open tables and its
	 * tournaments (side by side, or two tabs on a phone), then how to play.
	 */
	let {
		game,
		maintenance,
		rules
	}: {
		game: GameEntry;
		maintenance: boolean;
		rules: Snippet;
	} = $props();

	let opening = $state(false);
	let tableCount = $state(0);
	let tournamentCount = $state(0);
	let tab = $state<'tables' | 'tournaments'>('tables');

	const TABS = [
		{ id: 'tables', label: 'Tables' },
		{ id: 'tournaments', label: 'Tournaments' }
	] as const;
</script>

<nav class="pt-6 text-sm text-paper/55 md:pt-10" aria-label="Breadcrumb">
	<a class="hover:text-paper" href="/">Games</a>
	<span aria-hidden="true">/</span>
	<span class="font-medium text-paper/85" aria-current="page">{game.name}</span>
</nav>

<header class="mt-4 grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
	<div class="flex items-start gap-5">
		<span
			class="card-back {game.back} mt-1 h-[4.5rem] w-[3.25rem] shrink-0 -rotate-6 sm:h-[5.75rem] sm:w-16"
			aria-hidden="true"
		></span>
		<div>
			<h1 class="font-display text-4xl leading-none font-black sm:text-5xl">{game.name}</h1>
			<p class="mt-2 text-paper/80 sm:text-lg">{game.tagline}</p>
			<p class="mt-1 text-sm text-paper/50">
				{game.kind.charAt(0).toUpperCase()}{game.kind.slice(1)}, {game.minPlayers}–{game.maxPlayers}
				players
			</p>
			<a
				class="mt-2 inline-block text-sm font-semibold text-brass hover:underline"
				href="#how-to-play">How to play</a
			>
		</div>
	</div>
	<div class="flex flex-col gap-3 md:w-[26rem] md:flex-row">
		<button
			class="btn-brass h-12 shrink-0 rounded-xl px-6 text-base"
			onclick={() => (opening = true)}>Open a table</button
		>
		<TableCodeJoin game={game.slug} />
	</div>
</header>

<OpenTableDialog bind:open={opening} game={game.slug} gameName={game.name} {maintenance} />

<!-- Phones: one list at a time behind two tabs. Wider screens show both side by side. -->
<div class="mt-10 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 md:hidden" role="tablist">
	{#each TABS as t (t.id)}
		<button
			role="tab"
			aria-selected={tab === t.id}
			aria-controls="lobby-{t.id}"
			class="h-10 rounded-lg text-sm font-semibold {tab === t.id
				? 'bg-paper text-ink'
				: 'text-paper/75 hover:text-paper'}"
			onclick={() => (tab = t.id)}
		>
			{t.label}
			<span class="tabular-nums">{t.id === 'tables' ? tableCount : tournamentCount}</span>
		</button>
	{/each}
</div>

<div class="mt-5 grid gap-10 md:mt-12 md:grid-cols-[1.45fr_1fr] md:gap-8">
	<section
		id="lobby-tables"
		aria-labelledby="tables-title"
		class={tab === 'tables' ? '' : 'max-md:hidden'}
	>
		<h2
			id="tables-title"
			class="mb-4 flex items-center gap-2.5 font-display text-2xl font-bold max-md:sr-only"
		>
			Open tables
			<span
				class="rounded-full bg-black/35 px-2 py-0.5 font-sans text-xs text-paper/80 tabular-nums"
				>{tableCount}</span
			>
		</h2>
		<OpenTables game={game.slug} bind:count={tableCount} />
	</section>
	<section
		id="lobby-tournaments"
		aria-labelledby="tournaments-title"
		class={tab === 'tournaments' ? '' : 'max-md:hidden'}
	>
		<h2
			id="tournaments-title"
			class="mb-4 flex items-center gap-2.5 font-display text-2xl font-bold max-md:sr-only"
		>
			Tournaments
			<span
				class="rounded-full bg-black/35 px-2 py-0.5 font-sans text-xs text-paper/80 tabular-nums"
				>{tournamentCount}</span
			>
		</h2>
		<Tournaments game={game.slug} bind:count={tournamentCount} />
	</section>
</div>

<section id="how-to-play" class="mt-16 max-w-2xl scroll-mt-6" aria-label="How to play">
	{@render rules()}
</section>
