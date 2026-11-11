<script lang="ts">
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import Felt from './Felt.svelte';
	import Seat from './Seat.svelte';
	import Dealer from './Dealer.svelte';

	/** Any game's lobby: the table code, fixed seats, bots, and the host's Play button. */
	let { room, code, minPlayers, seats }: { room: RoomConnection<BaseView, unknown>; code: string; minPlayers: number; seats: number } = $props();
	const view = $derived(room.view!);
	const canStart = $derived(view.players.length >= minPlayers);
	/** A tournament table has no host controls: assigned players take their own seat and it starts by itself. */
	const tournament = $derived(view.tournament);
	const host = $derived(room.isHost && !tournament);

	let now = $state(Date.now());
	$effect(() => {
		if (!tournament || tournament.closed) return;
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});
	const countdown = (until: number | null) => {
		const s = Math.max(0, Math.ceil(((until ?? now) - now) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
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
				isHost={!tournament && p?.id === view.hostId}
				isMe={p?.id === room.playerId}
				action={host && p?.bot ? { label: 'remove', run: () => room.removeBot(p.id) } : undefined}
				onSit={p || tournament ? undefined : () => room.takeSeat(s)}
				onAddBot={!p && host ? () => room.addBot(s) : undefined}
			/>
		{/if}
	{/snippet}

	<div class="flex flex-col items-center gap-2 text-center">
		<p class="label">Table code</p>
		<p class="rounded-md border border-brass/50 bg-black/30 px-4 py-1 font-mono text-3xl tracking-[0.2em] text-brass sm:text-4xl">
			{code}
		</p>
		{#if tournament}
			<p class="text-sm text-paper/80">{tournament.name}</p>
		{:else}
			<button class="link-btn" onclick={copyLink}>
				{copied ? 'Link copied' : 'Copy invite link'}
			</button>
		{/if}
	</div>
</Felt>

<div class="mt-6 flex flex-col items-center gap-3">
	{#if tournament}
		{#if tournament.closed}
			<p class="text-sm text-ember" role="status">Not enough players showed up, so this table is closed.</p>
		{:else if (room.startsAt ?? now) > now}
			<p class="text-sm text-paper/75" aria-live="off">
				Starts by itself in <span class="font-mono tabular-nums text-paper">{countdown(room.startsAt)}</span>. {view.players.length} of {tournament.seats} players here.
			</p>
		{:else}
			<p class="text-sm text-paper/75" aria-live="off">
				Waiting for {tournament.seats - view.players.length} more. Starts with whoever is here in
				<span class="font-mono tabular-nums text-paper">{countdown(room.waitEndsAt)}</span>.
			</p>
		{/if}
	{:else if room.isHost}
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
