<script lang="ts">
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import Felt from './Felt.svelte';
	import Seat from './Seat.svelte';
	import Dealer from './Dealer.svelte';

	/** Any game's lobby: the table code, fixed seats, bots, and the host's Play button. */
	let { room, code, minPlayers, seats }: { room: RoomConnection<BaseView, unknown>; code: string; minPlayers: number; seats: number } = $props();
	const view = $derived(room.view!);
	const canStart = $derived(view.players.length >= minPlayers);
	const inSeat = (s: number) => view.players.find((p) => p.seat === s) ?? null;

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

<!-- Spot 0 is the dealer at the head of the table; chairs 1–6 follow clockwise. -->
<Felt count={seats + 1}>
	{#snippet seat(k)}
		{#if k === 0}
			<Dealer />
		{:else}
			{@const s = k - 1}
			{@const p = inSeat(s)}
			<Seat
				player={p}
				number={k}
				isHost={p?.id === view.hostId}
				isMe={p?.id === room.playerId}
				action={room.isHost && p?.bot ? { label: 'remove', run: () => room.removeBot(p.id) } : undefined}
				onSit={p ? undefined : () => room.takeSeat(s)}
				onAddBot={!p && room.isHost ? () => room.addBot(s) : undefined}
			/>
		{/if}
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
			<button class="btn-brass" onclick={room.start} disabled={room.busy || !canStart}>Play</button>
		</div>
		<p class="text-sm text-paper/75">
			{canStart ? `${view.players.length} players ready.` : `Needs at least ${minPlayers} players. Invite a friend, or press + on an empty seat to add a bot.`}
		</p>
	{:else}
		<p class="text-sm text-paper/75">Waiting for {view.players.find((p) => p.id === view.hostId)?.name ?? 'the host'} to start…</p>
	{/if}
</div>
