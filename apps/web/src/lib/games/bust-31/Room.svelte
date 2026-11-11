<script lang="ts">
	import { goto } from '$app/navigation';
	import type { GameEntry } from '#lib/games/catalog.ts';
	import { guestName, guestToken } from '#lib/guest.ts';
	import { onMount } from 'svelte';
	import { RoomConnection } from './connection.svelte.ts';
	import Lobby from './Lobby.svelte';
	import Table from './Table.svelte';

	let { game, code }: { game: GameEntry; code: string } = $props();
	let room = $state<RoomConnection | null>(null);

	onMount(() => {
		const name = guestName();
		if (!name) {
			goto(`/${game.slug}`);
			return;
		}
		const conn = new RoomConnection(code, guestToken(), name);
		room = conn;
		return () => void conn.dispose();
	});

	async function leave() {
		await room?.leave();
		goto(`/${game.slug}`);
	}
</script>

<div class="flex min-h-8 items-center justify-between pt-2">
	<h1 class="label">
		{#if room?.view?.phase === 'playing'}Table {code}, round {room.view.round}{:else}Table {code}{/if}
	</h1>
	{#if room?.view}
		<button class="link-btn" onclick={leave}>Leave table</button>
	{/if}
</div>

{#if room?.status === 'reconnecting'}
	<p class="mt-2 rounded-md border border-brass/40 bg-brass/10 px-3 py-2 text-center text-sm text-brass" role="status">
		Connection lost, reconnecting…
	</p>
{/if}

{#if !room || !room.view}
	<p class="pt-24 text-center font-display text-lg text-paper/75 italic" aria-live="polite">
		{room?.status === 'error' ? 'Could not reach the table.' : 'Setting up the table…'}
	</p>
	{#if room?.status === 'error'}
		<p class="mt-4 text-center"><button class="btn-ghost" onclick={() => location.reload()}>Try again</button></p>
	{/if}
{:else if room.view.phase === 'lobby'}
	<Lobby {room} {code} />
{:else}
	<Table {room} />
{/if}

{#if room?.error}
	<p class="mt-4 text-center text-sm text-ember" role="alert">{room.error}</p>
{/if}
