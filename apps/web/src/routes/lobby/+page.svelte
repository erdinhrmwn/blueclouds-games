<script lang="ts">
	import { page } from '$app/state';
	import { GAMES, gameBySlug } from '#lib/games/catalog.ts';
	import OpenTableDialog from '#lib/components/OpenTableDialog.svelte';
	import OpenTables from '#lib/components/OpenTables.svelte';
	import TableCodeJoin from '#lib/components/TableCodeJoin.svelte';
	import Tournaments from '#lib/components/Tournaments.svelte';
	import type { PageProps } from './$types';

	/**
	 * One lobby for every game: open or join a table, then the tournaments (a row that scrolls sideways) and the open
	 * tables of all games. `?game=<slug>` shows one game; an unknown slug shows them all.
	 */
	let { data }: PageProps = $props();

	const slugs = GAMES.map((entry) => entry.slug);

	const picked = $derived.by(() => {
		const slug = page.url.searchParams.get('game');

		return slug && gameBySlug(slug) ? slug : null;
	});

	let opening = $state(false);
	let tableCounts = $state<Record<string, number>>({});
	let tournamentCounts = $state<Record<string, number>>({});

	const countOf = (counts: Record<string, number>, slug: string | null) => {
		if (slug) {
			return counts[slug] ?? 0;
		}

		return Object.values(counts).reduce((sum, count) => sum + count, 0);
	};

	/** One chip for all games, then one per game in the catalog; each shows its tournaments and tables. */
	const chips = $derived([
		{ slug: null, name: 'All games', back: '', href: '/lobby' },
		...GAMES.map((entry) => ({
			slug: entry.slug,
			name: entry.name,
			back: entry.back,
			href: `/lobby?game=${entry.slug}`
		}))
	]);
</script>

<svelte:head><title>Lobby · BlueClouds Games</title></svelte:head>

<header class="mt-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
	<div>
		<h1 class="font-display text-[2rem] leading-tight font-black sm:text-[2.5rem]">Lobby</h1>
		<p class="mt-0.5 text-[15px] font-medium text-paper/80">
			Tournaments and open tables from every game.
		</p>
	</div>
	<div class="flex flex-col gap-3 md:w-[27.625rem] md:flex-row">
		<button
			class="btn-brass h-12 shrink-0 rounded-xl px-6 text-[15px] md:w-45"
			onclick={() => (opening = true)}>Open a table</button
		>
		<div class="min-w-0 flex-1"><TableCodeJoin /></div>
	</div>
</header>

<OpenTableDialog bind:open={opening} game={picked} paused={data.paused} />

<!-- Game chips scroll sideways once the games outgrow the row. -->
<nav class="chips -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Show games">
	{#each chips as chip (chip.href)}
		{@const active = chip.slug === picked}
		{@const total = countOf(tableCounts, chip.slug) + countOf(tournamentCounts, chip.slug)}
		<a
			href={chip.href}
			class="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border pr-3 text-sm font-semibold transition-colors {chip.back
				? 'pl-2'
				: 'pl-4'} {active
				? 'border-brass bg-brass/12 text-paper'
				: 'border-paper/15 text-paper/75 hover:border-paper/40'}"
			aria-current={active ? 'page' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			{#if chip.back}
				<span class="card-back {chip.back} block h-6 w-[17px] -rotate-6" aria-hidden="true"></span>
			{/if}
			{chip.name}
			<span class="text-xs font-semibold tabular-nums {active ? 'text-brass' : 'text-paper/45'}"
				>{total}</span
			>
		</a>
	{/each}
</nav>

<section id="lobby-tournaments" aria-labelledby="tournaments-title" class="mt-7">
	<h2
		id="tournaments-title"
		class="mb-3 flex items-center gap-3 font-display text-[1.375rem] font-bold"
	>
		Tournaments
		<span
			class="grid h-5 min-w-7 place-items-center rounded-full bg-black/35 px-2 font-sans text-[11.5px] font-semibold text-paper/80 tabular-nums"
			>{countOf(tournamentCounts, picked)}</span
		>
	</h2>
	<Tournaments games={slugs} game={picked} bind:counts={tournamentCounts} />
</section>

<section id="lobby-tables" aria-labelledby="tables-title" class="mt-4">
	<h2 id="tables-title" class="mb-4 flex items-center gap-3 font-display text-[1.375rem] font-bold">
		Open tables
		<span
			class="grid h-5 min-w-7 place-items-center rounded-full bg-black/35 px-2 font-sans text-[11.5px] font-semibold text-paper/80 tabular-nums"
			>{countOf(tableCounts, picked)}</span
		>
	</h2>
	<OpenTables games={slugs} game={picked} bind:counts={tableCounts} />
</section>

<style>
	.chips {
		scrollbar-width: none;
	}
</style>
