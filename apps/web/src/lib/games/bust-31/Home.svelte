<script lang="ts">
	import { goto } from '$app/navigation';
	import type { GameEntry } from '#lib/games/catalog.ts';
	import { guestName, isRoomCode, newRoomCode, saveGuestName } from '#lib/guest.ts';
	import { LIMIT } from 'server/games/bust-31/rules';
	import { onMount } from 'svelte';
	import PlayingCard from './PlayingCard.svelte';

	let { game }: { game: GameEntry } = $props();

	let name = $state('');
	let code = $state('');
	let error = $state<string | null>(null);

	onMount(() => (name = guestName()));

	function enter(roomCode: string) {
		const trimmed = name.trim();
		if (trimmed.length < 1 || trimmed.length > 20) return (error = 'Enter a name of 1–20 characters.');
		if (!isRoomCode(roomCode)) return (error = 'A table code is 4–8 letters or digits.');
		saveGuestName(trimmed);
		goto(`/${game.slug}/room/${roomCode}`);
	}

	const SAMPLE = [
		{ id: 's1', kind: 'number', value: 7 },
		{ id: 's2', kind: 'minus', value: -5 },
		{ id: 's3', kind: 'reverse', value: 0 }
	] as const;
</script>

<div class="grid gap-12 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-16">
	<section>
		<p class="label mb-3">{game.name}, a turn-based card game for {game.minPlayers} to {game.maxPlayers} players</p>
		<h1 class="font-display text-5xl leading-[0.95] font-black sm:text-6xl">
			Don’t be the one<br />who <span class="text-ember italic">busts.</span>
		</h1>
		<div class="mt-8 flex" aria-hidden="true">
			{#each SAMPLE as card, i (card.id)}
				<div class="-mr-3" style="transform: rotate({(i - 1) * 8}deg) translateY({i === 1 ? -6 : 0}px)">
					<PlayingCard {card} />
				</div>
			{/each}
		</div>
	</section>

	<section class="rounded-xl border border-paper/15 bg-[#1b1611] p-6" aria-label="Join a table">
		<form class="space-y-3" onsubmit={(e) => (e.preventDefault(), enter(newRoomCode()))}>
			<label class="block">
				<span class="label mb-1.5 block">Your name at the table</span>
				<input class="field" bind:value={name} maxlength="20" autocomplete="nickname" placeholder="e.g. Rina" required />
			</label>
			<button class="btn-brass w-full" type="submit">Open a new table</button>
		</form>

		<hr class="my-6 border-paper/15" />

		<form onsubmit={(e) => (e.preventDefault(), enter(code.trim().toUpperCase()))}>
			<label class="label mb-1.5 block" for="code">Got a code from a friend?</label>
			<div class="flex gap-2">
				<input id="code" class="field font-mono tracking-[0.2em] uppercase" bind:value={code} maxlength="8" placeholder="CODE" autocomplete="off" />
				<button class="btn-ghost shrink-0" type="submit">Join table</button>
			</div>
		</form>

		{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}
	</section>
</div>

<section class="mt-16 max-w-2xl" aria-labelledby="rules-title">
	<h2 id="rules-title" class="font-display text-2xl font-bold">There is only one rule: don’t go over {LIMIT}.</h2>
	<p class="mt-3 leading-relaxed text-paper/80">
		Everyone holds three cards and has three lives. On your turn you play one card and its value is added to the total in the
		middle of the table. Whoever pushes the total over {LIMIT} loses a life, and the cards are dealt again. The last player with
		lives left wins.
	</p>
	<p class="mt-3 leading-relaxed text-paper/80">
		Save the special cards for tight spots: <b class="text-paper">0</b> to pass without adding,
		<b class="text-paper">−5</b> to bring the total down, and <b class="text-paper">⇄</b> to reverse the turn order.
	</p>
</section>
