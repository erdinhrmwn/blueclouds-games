<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import JoinPanel from '#lib/components/JoinPanel.svelte';
	import OpenTables from '#lib/components/OpenTables.svelte';
	import Tournaments from '#lib/components/Tournaments.svelte';
	import { LIMIT } from 'server/games/bust-31/rules';
	import Fan from './Fan.svelte';

	let { game, maintenance }: { game: GameEntry; maintenance: boolean } = $props();
</script>

<div class="grid gap-12 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-16">
	<section>
		<p class="label mb-3">
			{game.name}, a {game.kind} card game for {game.minPlayers} to {game.maxPlayers} players
		</p>
		<h1 class="font-display text-5xl leading-[0.95] font-black sm:text-6xl">
			Don’t be the one<br />who <span class="text-ember italic">busts.</span>
		</h1>
		<div class="mt-8">
			<Fan />
		</div>
	</section>

	<JoinPanel game={game.slug} {maintenance} />
</div>

<Tournaments game={game.slug} />

<OpenTables game={game.slug} />

<section class="mt-16 max-w-2xl" aria-labelledby="rules-title">
	<h2 id="rules-title" class="font-display text-2xl font-bold">
		There is only one rule: don’t go over {LIMIT}.
	</h2>
	<p class="mt-3 leading-relaxed text-paper/80">
		Everyone holds three cards and has three lives. On your turn you play one card and its value is
		added to the total in the middle of the table. Whoever pushes the total over {LIMIT} loses a life,
		and the cards are dealt again. The last player with lives left wins.
	</p>
	<p class="mt-3 leading-relaxed text-paper/80">
		Save the special cards for tight spots: <b class="text-paper">0</b> to pass without adding,
		<b class="text-paper">−5</b> to bring the total down, and <b class="text-paper">⇄</b> to reverse the
		turn order.
	</p>
</section>
