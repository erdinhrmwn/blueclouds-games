<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import JoinPanel from '#lib/components/JoinPanel.svelte';
	import OpenTables from '#lib/components/OpenTables.svelte';
	import Tournaments from '#lib/components/Tournaments.svelte';
	import { BURST_AT, HAND_SIZE } from 'server/games/cloudburst/rules';
	import Fan from './Fan.svelte';

	let { game }: { game: GameEntry } = $props();
</script>

<div class="grid gap-12 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-16">
	<section>
		<p class="label mb-3">
			{game.name}, a {game.kind} card game for {game.minPlayers} to {game.maxPlayers} players
		</p>
		<h1 class="font-display text-5xl leading-[0.95] font-black sm:text-6xl">
			Empty your hand<br />before the sky <span class="text-ember italic">breaks.</span>
		</h1>
		<div class="mt-8">
			<Fan />
		</div>
	</section>

	<JoinPanel game={game.slug} />
</div>

<Tournaments game={game.slug} />

<OpenTables game={game.slug} />

<section class="mt-16 max-w-2xl" aria-labelledby="rules-title">
	<h2 id="rules-title" class="font-display text-2xl font-bold">
		Play a card that fits, and be first to run out.
	</h2>
	<p class="mt-3 leading-relaxed text-paper/80">
		Everyone gets {HAND_SIZE} cards. A card fits the pile when it has the same weather, or a number exactly
		one higher or lower than the top card. Nothing fits? Draw one, and play it if you can. The first player
		with an empty hand ends the round, and everyone else gets a point for each card still in their hand.
		Reach {BURST_AT} points and your cloud bursts: the match ends and the fewest points wins.
	</p>
	<p class="mt-3 leading-relaxed text-paper/80">
		Action cards fit their own weather or the same action: <b class="text-paper">Calm</b> skips the
		next player,
		<b class="text-paper">Swirl</b> turns the table the other way, and
		<b class="text-paper">Gust</b>
		lets you hand one of your cards to the next player. A <b class="text-paper">Rainbow</b> fits anything
		and picks the weather.
	</p>
</section>
