<script lang="ts">
	import type { GameEntry } from '#lib/games/catalog.ts';
	import GameLobby from '#lib/components/GameLobby.svelte';
	import { LIMIT } from 'server/games/bust-31/rules';

	let { game, maintenance }: { game: GameEntry; maintenance: boolean } = $props();
</script>

<GameLobby {game} {maintenance}>
	{#snippet rules()}
		<h2 id="rules-title" class="font-display text-2xl font-bold">
			There is only one rule: don’t go over {LIMIT}.
		</h2>
		<p class="mt-3 leading-relaxed text-paper/80">
			Everyone holds three cards and has three lives. On your turn you play one card and its value
			is added to the total in the middle of the table. Whoever pushes the total over {LIMIT} loses a
			life, and the cards are dealt again. The last player with lives left wins.
		</p>
		<p class="mt-3 leading-relaxed text-paper/80">
			Save the special cards for tight spots: <b class="text-paper">Skip</b> to pass without adding,
			<b class="text-paper">−5</b> to bring the total down, and <b class="text-paper">Flip</b> to
			reverse the turn order. Rarer ones: <b class="text-paper">Swap</b> trades hands with the next
			player,
			<b class="text-paper">Ten</b> sets the total to 10, and <b class="text-paper">Double</b> makes the
			next player play two cards in a row.
		</p>
	{/snippet}
</GameLobby>
