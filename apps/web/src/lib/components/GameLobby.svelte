<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import type { Snippet } from 'svelte';
	import OpenTableDialog from './OpenTableDialog.svelte';
	import OpenTables from './OpenTables.svelte';
	import TableCodeJoin from './TableCodeJoin.svelte';
	import Tournaments from './Tournaments.svelte';

	/**
	 * A game's own page, the same for every game: the game, open or join a table, its tournaments (a row that
	 * scrolls sideways), its open tables (a table), then how to play.
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
</script>

<nav class="pt-2 text-[13px] text-paper/55" aria-label="Breadcrumb">
	<a class="hover:text-paper" href="/">Games</a>
	<span aria-hidden="true">/</span>
	<span class="font-medium text-paper/85" aria-current="page">{game.name}</span>
</nav>

<header class="mt-3 grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
	<div class="flex items-start gap-5">
		<span
			class="card-back {game.back} mt-1 h-[4.5rem] w-[3.25rem] shrink-0 -rotate-6 sm:h-[5.75rem] sm:w-16"
			aria-hidden="true"
		></span>
		<div>
			<h1 class="font-display text-4xl leading-tight font-black sm:text-[2.5rem]">{game.name}</h1>
			<p class="mt-0.5 text-[15px] font-medium text-paper/80">{game.rule}</p>
			<p class="mt-1 text-[13px] font-medium text-paper/50">
				{game.kind.charAt(0).toUpperCase()}{game.kind.slice(1)} · {game.minPlayers}–{game.maxPlayers}
				players · {game.fact}
			</p>
			<a
				class="mt-0.5 inline-block text-[13px] font-semibold text-brass hover:underline"
				href="#how-to-play">How to play</a
			>
		</div>
	</div>
	<div class="flex flex-col gap-3 md:w-[27.625rem] md:flex-row">
		<button
			class="btn-brass h-12 shrink-0 rounded-xl px-6 text-[15px] md:w-45"
			onclick={() => (opening = true)}>Open a table</button
		>
		<div class="min-w-0 flex-1"><TableCodeJoin game={game.slug} /></div>
	</div>
</header>

<OpenTableDialog bind:open={opening} game={game.slug} gameName={game.name} {maintenance} />

<!-- Tournaments first, as a row that scrolls sideways; then the open tables. -->
<section id="lobby-tournaments" aria-labelledby="tournaments-title" class="mt-7">
	<h2
		id="tournaments-title"
		class="mb-3 flex items-center gap-3 font-display text-[1.375rem] font-bold"
	>
		Tournaments
		<span
			class="grid h-5 min-w-7 place-items-center rounded-full bg-black/35 px-2 font-sans text-[11.5px] font-semibold text-paper/80 tabular-nums"
			>{tournamentCount}</span
		>
	</h2>
	<Tournaments game={game.slug} bind:count={tournamentCount} />
</section>

<section id="lobby-tables" aria-labelledby="tables-title" class="mt-4">
	<h2 id="tables-title" class="mb-4 flex items-center gap-3 font-display text-[1.375rem] font-bold">
		Open tables
		<span
			class="grid h-5 min-w-7 place-items-center rounded-full bg-black/35 px-2 font-sans text-[11.5px] font-semibold text-paper/80 tabular-nums"
			>{tableCount}</span
		>
	</h2>
	<OpenTables game={game.slug} bind:count={tableCount} />
</section>

<section id="how-to-play" class="mt-16 max-w-2xl scroll-mt-6" aria-label="How to play">
	{@render rules()}
</section>
