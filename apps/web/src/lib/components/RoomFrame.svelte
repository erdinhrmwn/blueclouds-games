<script lang="ts" generics="R extends RoomConnection<BaseView, unknown>">
	import { goto } from '$app/navigation';
	import type { GameEntry } from '#lib/games/catalog.ts';
	import { player } from '#lib/player.svelte.ts';
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import { fetchTournaments, type LiveTournament } from '#lib/platform.ts';
	import { FORMATS } from '#lib/tournament-formats.ts';
	import type { Snippet } from 'svelte';
	import FairPlay from './FairPlay.svelte';
	import Lobby from './Lobby.svelte';
	import Marquee from './Marquee.svelte';
	import TournamentLiveDialog from './TournamentLiveDialog.svelte';

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
		if (!player.name || connected) {
			return;
		}

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
		if (!view) {
			return 'Table';
		}

		if (view.tournament) {
			return view.tournament.name;
		}

		if (view.roomName) {
			return view.roomName;
		}

		const host = view.players.find((p) => p.id === view.hostId);
		return host ? `${host.name}’s table` : 'Table';
	});

	/** Shows a tick on the copy button for a moment after the code is copied. */
	const COPIED_MS = 1500;
	let copied = $state(false);

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
		} catch {
			// The browser blocked the clipboard: the code is on screen to copy by hand.
			return;
		}

		copied = true;
		setTimeout(() => {
			copied = false;
		}, COPIED_MS);
	}

	/** The tournament's standings, opened from the sign; read from the lobby's list when asked for. */
	const STANDINGS_TICK_MS = 1_000;
	let standingsOpen = $state(false);
	let standingsOf = $state<LiveTournament | null>(null);
	let standingsNow = $state(Date.now());

	async function showStandings() {
		const id = room?.view?.tournament?.id;
		if (!id) {
			return;
		}

		try {
			const { live } = await fetchTournaments(game.slug);
			standingsOf = live.find((entry) => entry.id === id) ?? null;
		} catch {
			standingsOf = null;
		}

		standingsNow = Date.now();
		standingsOpen = true;
	}

	$effect(() => {
		if (!standingsOpen) {
			return;
		}

		const tick = setInterval(() => {
			standingsNow = Date.now();
		}, STANDINGS_TICK_MS);

		return () => clearInterval(tick);
	});

	async function leave() {
		await room?.leave();
		goto(`/${game.slug}`);
	}
</script>

{#snippet roomCode()}
	<span class="chip">
		<span class="text-paper/55">Room</span>
		<span class="font-semibold text-paper/90">{code}</span>
		<button
			class="-my-1 -mr-1.5 grid size-6 place-items-center rounded-full text-brass hover:bg-paper/10"
			onclick={copyCode}
			aria-label={copied ? 'Room code copied' : 'Copy room code'}
			title={copied ? 'Copied' : 'Copy room code'}
		>
			<svg
				viewBox="0 0 20 20"
				class="size-3.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if copied}
					<path d="M4.5 10.5l3.5 3.5 7.5-8" stroke-linecap="round" />
				{:else}
					<rect x="7" y="7" width="9" height="10" rx="2" />
					<path d="M4 13V5a2 2 0 0 1 2-2h7" />
				{/if}
			</svg>
		</button>
	</span>
{/snippet}

<TournamentLiveDialog
	bind:open={standingsOpen}
	tournament={standingsOf}
	game={game.slug}
	back={game.back}
	now={standingsNow}
/>

<!-- The room's sign: its name on top, its code, round and seats below, framed in brass like the table.
	 Phones put the buttons on their own row so the sign keeps the full width. -->
<header
	class="mb-4 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center {player.playing
		? 'pt-4'
		: 'pt-3'}"
>
	<div class="hidden w-24 shrink-0 sm:block" aria-hidden="true"></div>
	{#if room?.view}
		<div class="order-first flex items-center justify-end gap-2 sm:order-last sm:w-24 sm:shrink-0">
			{#if room.status !== 'refused'}
				<FairPlay {room} game={game.slug} />
			{/if}
			<button
				class="btn-ghost size-10 shrink-0 p-0 sm:size-11"
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
	<div
		class="placard mx-auto w-full max-w-md min-w-0 flex-1 rounded-2xl px-4 py-3 text-center sm:px-6"
	>
		<h1 class="font-display text-lg leading-tight font-bold text-paper sm:text-xl">
			<span class="sr-only">{game.name},&nbsp;</span><Marquee text={roomName} />
		</h1>
		<p
			class="mt-2 flex flex-wrap items-center justify-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs"
		>
			{#if room?.view?.tournament}
				{@const tournament = room.view.tournament}
				{#if tournament.format}
					<span class="chip text-brass">{FORMATS[tournament.format].label}</span>
				{:else}
					<span class="chip text-brass">Tournament</span>
				{/if}
				{#if tournament.round}
					<span class="chip font-semibold text-paper/90 tabular-nums"
						>Stage {tournament.round}{#if tournament.rounds}&nbsp;of {tournament.rounds}{/if}</span
					>
				{/if}
				<span class="chip"
					><span class="text-paper/55">Players</span>
					<span class="font-semibold text-paper/90 tabular-nums"
						>{room.view.players.length}/{tournament.seats}{#if tournament.registered}&nbsp;·
							{tournament.registered} registered{/if}</span
					></span
				>
				{#if tournament.id}
					<button
						class="chip relative text-brass after:absolute after:-inset-x-1 after:-inset-y-3 hover:bg-paper/10"
						onclick={showStandings}>Standings</button
					>
				{/if}
				{@render roomCode()}
			{:else}
				{@render roomCode()}
				{#if room?.view && room.view.phase !== 'lobby'}
					<span class="chip"
						><span class="text-paper/55">Round</span>
						<span class="font-semibold text-paper/90 tabular-nums">{room.view.round}</span></span
					>
				{/if}
				{#if room?.view}
					<span class="chip"
						><span class="text-paper/55">Players</span>
						<span class="font-semibold text-paper/90 tabular-nums"
							>{room.view.players.length}/{game.maxPlayers}</span
						></span
					>
				{/if}
			{/if}
		</p>
	</div>
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

<style>
	/* The sign hangs from a short brass rod, like the one over a casino table. */
	.placard {
		position: relative;
		background: #1c1510;
		box-shadow:
			inset 0 0 0 1.5px var(--color-brass),
			inset 0 0 0 5px #1c1510,
			inset 0 0 0 6px rgb(210 165 76 / 0.22),
			0 8px 18px rgb(0 0 0 / 0.4);
	}
	.placard::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		width: 2px;
		height: 1rem;
		translate: -50% 0;
		background: rgb(210 165 76 / 0.7);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border-radius: 9999px;
		background: rgb(0 0 0 / 0.4);
		padding: 0.25rem 0.5rem;
		white-space: nowrap;
	}
</style>
