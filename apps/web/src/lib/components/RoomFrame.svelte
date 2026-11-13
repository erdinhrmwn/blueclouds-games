<script lang="ts" generics="R extends RoomConnection<BaseView, unknown>">
	import { goto } from '$app/navigation';
	import type { GameEntry } from '#lib/games/catalog.ts';
	import { player } from '#lib/player.svelte.ts';
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import type { Snippet } from 'svelte';
	import FairPlay from './FairPlay.svelte';
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

<!-- Game as a small brass eyebrow, the room's name as the title, then its code and round. -->
<header
	class="mb-4 flex items-center justify-between gap-4 border-b border-paper/10 pb-4 sm:mb-6 {player.playing
		? 'pt-4'
		: 'pt-3'}"
>
	<div class="min-w-0">
		<p
			class="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-brass uppercase"
		>
			{game.name}
			{#if room?.view?.tournament}
				<span
					class="rounded-full px-2 py-0.5 tracking-normal normal-case ring-1 ring-brass/40 ring-inset"
					>Tournament</span
				>
			{/if}
		</p>
		<h1 class="mt-1 truncate font-display text-xl leading-tight font-bold text-paper sm:text-2xl">
			{roomName}
		</h1>
		<p class="mt-1.5 flex items-center gap-2 text-xs text-paper/60">
			<span>Room <span class="font-mono tracking-[0.15em] text-paper/90">{code}</span></span>
			{#if room?.view && room.view.phase !== 'lobby'}
				<span class="size-1 rounded-full bg-paper/30" aria-hidden="true"></span>
				<span
					>Round <span class="font-semibold text-paper/90 tabular-nums">#{room.view.round}</span
					></span
				>
			{/if}
		</p>
	</div>
	{#if room?.view}
		<div class="flex shrink-0 items-center gap-2">
			{#if room.status !== 'refused'}
				<FairPlay {room} />
			{/if}
			<button
				class="btn-ghost size-11 shrink-0 p-0"
				onclick={leave}
				aria-label="Leave table"
				title="Leave table"
			>
				<svg
					viewBox="0 0 20 20"
					class="size-5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 14l4-4-4-4M17 10H8" />
				</svg>
			</button>
		</div>
	{/if}
</header>

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
