<script lang="ts">
	import { GAMES } from '#lib/games/catalog.ts';
</script>

<section class="pt-10 md:pt-16">
	<p class="label mb-3">Browser card games for friends and bots</p>
	<h1 class="font-display text-5xl leading-[0.95] font-black sm:text-6xl">Pick a game.</h1>
</section>

<ul class="mt-10 grid gap-4 sm:grid-cols-2">
	{#each GAMES as game (game.slug)}
		<li>
			<a
				href="/{game.slug}"
				class="block min-h-11 rounded-xl border border-paper/15 bg-[#1b1611] p-6 transition-colors hover:border-brass/60 focus-visible:border-brass"
			>
				<span class="font-display text-2xl font-bold">{game.name}</span>
				<span class="mt-2 block leading-relaxed text-paper/80">{game.tagline}</span>
				<span class="label mt-4 block">{game.minPlayers}–{game.maxPlayers} players</span>
			</a>
		</li>
	{/each}
</ul>
