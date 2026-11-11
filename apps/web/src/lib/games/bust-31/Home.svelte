<script lang="ts">
	import { goto } from '$app/navigation';
	import type { GameEntry } from '#lib/games/catalog.ts';
	import { isRoomCode, newRoomCode } from '#lib/guest.ts';
	import { player } from '#lib/player.svelte.ts';
	import { LIMIT } from 'server/games/bust-31/rules';
	import { onMount } from 'svelte';
	import PlayingCard from './PlayingCard.svelte';
	import { RoomList } from '#lib/rooms.svelte.ts';

	let { game }: { game: GameEntry } = $props();

	let code = $state('');
	let error = $state<string | null>(null);

	let list = $state<RoomList | null>(null);

	onMount(() => {
		const rooms = new RoomList(game.slug);
		list = rooms;
		return () => rooms.dispose();
	});

	function enter(roomCode: string) {
		if (!isRoomCode(roomCode)) return (error = 'A table code is 4–8 letters or digits.');
		if (!player.name) return (player.editing = true); // the name dialog shows; try again after
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
			<p class="label">Start a game and invite friends or bots.</p>
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

<section class="mt-16" aria-labelledby="tables-title">
	<h2 id="tables-title" class="font-display text-2xl font-bold">Open tables</h2>
	{#if !list || list.status === 'loading'}
		<p class="mt-3 text-paper/75" aria-live="polite">Looking for tables…</p>
	{:else if list.status === 'error'}
		<p class="mt-3 text-paper/75">Could not load the tables. You can still join with a code.</p>
	{:else if list.rooms.length === 0}
		<p class="mt-3 text-paper/75">No tables open right now. Open one and share the code.</p>
	{:else}
		<ul class="mt-4 divide-y divide-paper/10 rounded-xl border border-paper/15 bg-[#1b1611]">
			{#each list.rooms as r (r.code)}
				{@const open = r.phase === 'lobby' && r.players < r.maxPlayers}
				<li class="flex items-center gap-4 px-4 py-3">
					<span class="font-mono text-lg tracking-[0.15em] text-brass">{r.code}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{r.host ? `${r.host}’s table` : 'Table'}</span>
						<span class="block text-sm text-paper/75">
							{r.players}/{r.maxPlayers} players ·
							{r.phase === 'playing' ? 'Playing' : r.phase === 'finished' ? 'Finished' : open ? 'In lobby' : 'Full'}
						</span>
					</span>
					<button class="btn-ghost shrink-0" onclick={() => enter(r.code)} disabled={!open} aria-label="Join table {r.code}">
						Join
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

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
