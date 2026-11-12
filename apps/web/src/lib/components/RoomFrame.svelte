<script lang="ts" generics="R extends RoomConnection<BaseView, unknown>">
	import { goto } from '$app/navigation';
	import type { GameEntry } from '#lib/games/catalog.ts';
	import { player } from '#lib/player.svelte.ts';
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import type { Snippet } from 'svelte';
	import Lobby from './Lobby.svelte';

	/** Everything around a game's table: connecting, the lobby, reconnect and error lines, leaving. */
	let {
		game,
		code,
		connect,
		table
	}: { game: GameEntry; code: string; connect: () => R; table: Snippet<[R]> } = $props();

	let room = $state<R | null>(null);

	// Connect once there is a name; someone opening an invite link first fills in the name dialog.
	// The name is read once: changing it later applies to the next table you join.
	let connected = false;
	$effect(() => {
		if (!player.name || connected) return;

		connected = true;
		room = connect();
	});

	$effect(() => {
		return () => void room?.dispose();
	});

	// Hide the site header once the game starts, so the screen is all table.
	$effect(() => {
		player.playing = !!room?.view && room.view.phase !== 'lobby';

		return () => {
			player.playing = false;
		};
	});

	/** A tournament table goes by its tournament's name; any other table by its host's. */
	const roomName = $derived.by(() => {
		const view = room?.view;
		if (!view) return 'Table';
		if (view.tournament) return view.tournament.name;

		const host = view.players.find((p) => p.id === view.hostId);
		return host ? `${host.name}’s table` : 'Table';
	});

	async function leave() {
		await room?.leave();
		goto(`/${game.slug}`);
	}
</script>

<div class="flex min-h-8 items-center justify-between gap-3 {player.playing ? 'pt-3' : 'pt-2'}">
	<!-- Game name, then the room's name, then the round once dealt: one per line. -->
	<div class="min-w-0">
		<h1 class="font-display text-lg leading-tight font-bold text-paper">{game.name}</h1>
		<p class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-paper/90">
			{#if room?.view?.tournament}
				<span class="shrink-0 rounded-sm bg-brass px-1 text-[10px] text-ink">Tournament</span>
			{/if}
			<span class="truncate">{roomName}</span>
		</p>
		{#if room?.view && room.view.phase !== 'lobby'}
			<p class="text-xs text-paper/70 tabular-nums">Round #{room.view.round}</p>
		{/if}
	</div>
	{#if room?.view}
		<button class="link-btn" onclick={leave}>Leave table</button>
	{/if}
</div>

{#if room?.status === 'reconnecting'}
	<p
		class="mt-2 rounded-md border border-brass/40 bg-brass/10 px-3 py-2 text-center text-sm text-brass"
		role="status"
	>
		Connection lost, reconnecting…
	</p>
{/if}

{#if room?.status === 'refused'}
	<p class="pt-24 text-center font-display text-lg text-paper/75 italic">
		You can't join this table.
	</p>
	<p class="mt-4 text-center"><a class="btn-ghost" href="/{game.slug}">Back to {game.name}</a></p>
{:else if !room || !room.view}
	<p class="pt-24 text-center font-display text-lg text-paper/75 italic" aria-live="polite">
		{room?.status === 'error' ? 'Could not reach the table.' : 'Setting up the table…'}
	</p>
	{#if room?.status === 'error'}
		<p class="mt-4 text-center">
			<button class="btn-ghost" onclick={() => location.reload()}>Try again</button>
		</p>
	{/if}
{:else if room.view.phase === 'lobby'}
	<Lobby {room} {code} minPlayers={game.minPlayers} seats={game.maxPlayers} />
{:else}
	{@render table(room)}
{/if}

{#if room?.error}
	<p class="mt-4 text-center text-sm text-ember" role="alert">{room.error}</p>
{/if}
