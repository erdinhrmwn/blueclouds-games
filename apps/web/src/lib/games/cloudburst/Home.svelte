<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import JoinPanel from '#lib/components/JoinPanel.svelte';
	import OpenTables from '#lib/components/OpenTables.svelte';
	import { BURST_AT, type Card, HAND_SIZE } from 'server/games/cloudburst/rules';
	import CloudCard from './CloudCard.svelte';

	let { game }: { game: GameEntry } = $props();

	const SAMPLE: Card[] = [
		{ id: 's1', kind: 'number', suit: 'rain', value: 4 },
		{ id: 's2', kind: 'number', suit: 'rain', value: 5 },
		{ id: 's3', kind: 'gust', suit: 'wind', value: 0 },
		{ id: 's4', kind: 'rainbow', suit: null, value: 0 }
	];
</script>

<div class="grid gap-12 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-16">
	<section>
		<p class="label mb-3">{game.name}, a shedding card game for {game.minPlayers} to {game.maxPlayers} players</p>
		<h1 class="font-display text-5xl leading-[0.95] font-black sm:text-6xl">
			Empty your hand<br />before the sky <span class="text-ember italic">breaks.</span>
		</h1>
		<div class="mt-8 flex" aria-hidden="true">
			{#each SAMPLE as card, i (card.id)}
				<div class="-mr-3" style="transform: rotate({(i - 1.5) * 7}deg) translateY({i === 1 || i === 2 ? -6 : 0}px)">
					<CloudCard {card} />
				</div>
			{/each}
		</div>
	</section>

	<JoinPanel game={game.slug} />
</div>

<OpenTables game={game.slug} />

<section class="mt-16 max-w-2xl" aria-labelledby="rules-title">
	<h2 id="rules-title" class="font-display text-2xl font-bold">Play a card that fits, and be first to run out.</h2>
	<p class="mt-3 leading-relaxed text-paper/80">
		Everyone gets {HAND_SIZE} cards. A card fits the pile when it has the same weather, or a number exactly one higher or lower
		than the top card. Nothing fits? Draw one, and play it if you can. The first player with an empty hand ends the round, and
		everyone else gets a point for each card still in their hand. Reach {BURST_AT} points and your cloud bursts: the match ends
		and the fewest points wins.
	</p>
	<p class="mt-3 leading-relaxed text-paper/80">
		Action cards fit their own weather or the same action: <b class="text-paper">Calm</b> skips the next player,
		<b class="text-paper">Swirl</b> turns the table the other way, and <b class="text-paper">Gust</b> lets you hand one of your
		cards to the next player. A <b class="text-paper">Rainbow</b> fits anything and picks the weather.
	</p>
</section>
