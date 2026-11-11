<script lang="ts">
	import type { RoomConnection } from './connection.svelte.ts';
	import { MAX_PLAYERS, MIN_PLAYERS } from 'server/games/bust-31/rules';
	import Felt from '#lib/components/Felt.svelte';
	import Seat from '#lib/components/Seat.svelte';

	let { room, code }: { room: RoomConnection; code: string } = $props();
	const view = $derived(room.view!);
	const full = $derived(view.players.length >= MAX_PLAYERS);
	const canStart = $derived(view.players.length >= MIN_PLAYERS);

	// Viewer at the bottom, then the others in join order, then empty chairs.
	const ordered = $derived.by(() => {
		const me = view.players.findIndex((p) => p.id === room.playerId);
		const n = view.players.length;
		return Array.from({ length: MAX_PLAYERS }, (_, k) => (k < n ? view.players[(Math.max(0, me) + k) % n]! : null));
	});

	let copied = $state(false);
	async function copyLink() {
		try {
			await navigator.clipboard.writeText(location.href);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false; // clipboard blocked: the code is still visible to read out
		}
	}
</script>

<Felt count={MAX_PLAYERS}>
	{#snippet seat(k)}
		{@const p = ordered[k] ?? null}
		<Seat
			player={p}
			isHost={p?.id === view.hostId}
			isMe={p?.id === room.playerId}
			action={room.isHost && p?.bot ? { label: 'remove', run: () => room.removeBot(p.id) } : undefined}
		/>
	{/snippet}

	<div class="flex flex-col items-center gap-2 text-center">
		<p class="label">Table code</p>
		<p class="rounded-md border border-brass/50 bg-black/30 px-4 py-1 font-mono text-3xl tracking-[0.2em] text-brass sm:text-4xl">
			{code}
		</p>
		<button class="link-btn" onclick={copyLink}>
			{copied ? 'Link copied' : 'Copy invite link'}
		</button>
	</div>
</Felt>

<div class="mt-6 flex flex-col items-center gap-3">
	{#if room.isHost}
		<div class="flex flex-wrap justify-center gap-3">
			<button class="btn-ghost" onclick={room.addBot} disabled={room.busy || full}>Add bot</button>
			<button class="btn-brass" onclick={room.start} disabled={room.busy || !canStart}>Deal cards</button>
		</div>
		<p class="text-sm text-paper/75">
			{canStart ? `${view.players.length} players ready.` : `Needs at least ${MIN_PLAYERS} players. Invite a friend or add a bot.`}
		</p>
	{:else}
		<p class="text-sm text-paper/75">Waiting for {view.players.find((p) => p.id === view.hostId)?.name ?? 'the host'} to deal…</p>
	{/if}
</div>
