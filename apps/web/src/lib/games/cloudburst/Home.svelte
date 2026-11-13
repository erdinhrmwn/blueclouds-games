<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import GameLobby from '#lib/components/GameLobby.svelte';
	import { BURST_AT, HAND_SIZE } from 'server/games/cloudburst/rules';

	let { game, maintenance }: { game: GameEntry; maintenance: boolean } = $props();
</script>

<GameLobby {game} {maintenance}>
	{#snippet rules()}
		<h2 id="rules-title" class="font-display text-2xl font-bold">
			Play a card that fits, and be first to run out.
		</h2>
		<p class="mt-3 leading-relaxed text-paper/80">
			Everyone gets {HAND_SIZE} cards. A card fits the pile when it has the same weather, or a number
			exactly one higher or lower than the top card. Nothing fits? Draw one, and play it if you can. The
			first player with an empty hand ends the round, and everyone else gets a point for each card still
			in their hand. Reach {BURST_AT} points and your cloud bursts: the match ends and the fewest points
			wins.
		</p>
		<p class="mt-3 leading-relaxed text-paper/80">
			Action cards fit their own weather or the same action: <b class="text-paper">Calm</b> skips
			the next player,
			<b class="text-paper">Swirl</b> turns the table the other way, and
			<b class="text-paper">Gust</b>
			lets you hand one of your cards to the next player, and <b class="text-paper">Downpour</b>
			makes the next player draw two and lose their turn. A <b class="text-paper">Rainbow</b> fits
			anything and picks the weather; a <b class="text-paper">Tempest</b> does too, and the next player
			draws four and loses their turn. Draw cards don’t stack.
		</p>
	{/snippet}
</GameLobby>
