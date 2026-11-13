<script lang="ts">
	import { createInvite, resetInviteLink } from '#lib/platform.ts';
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import Felt from './Felt.svelte';
	import Seat from './Seat.svelte';
	import Dealer from './Dealer.svelte';

	/** Any game's lobby: invites, fixed seats, bots, and the host's Play button. */
	let {
		room,
		code,
		minPlayers,
		seats
	}: {
		room: RoomConnection<BaseView, unknown>;
		code: string;
		minPlayers: number;
		seats: number;
	} = $props();

	const COPIED_NOTE_MS = 1500;

	const view = $derived(room.view!);
	const canStart = $derived(view.players.length >= minPlayers);
	/** A tournament table has no host controls: assigned players take their own seat and it starts by itself. */
	const tournament = $derived(view.tournament);
	const host = $derived(room.isHost && !tournament);

	let now = $state(Date.now());
	$effect(() => {
		if (!tournament || tournament.closed) return;

		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(tick);
	});

	/** "4:07" until a time, counting down with `now`. */
	const countdown = (until: number | null) => {
		const seconds = Math.max(0, Math.ceil(((until ?? now) - now) / 1000));
		const minutes = Math.floor(seconds / 60);
		return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
	};

	const inSeat = (seat: number) => view.players.find((p) => p.seat === seat) ?? null;

	/** What the host can do to a seated player: remove a bot, or kick someone else (who can't come back). */
	const hostAction = (player: BaseView['players'][number] | null) => {
		if (!host || !player || player.id === room.playerId) {
			return undefined;
		}

		if (player.bot) {
			return { label: 'remove', run: () => room.removeBot(player.id) };
		}

		const kick = () => {
			const sure = confirm(`Kick ${player.name}? They can't come back to this table.`);
			if (sure) {
				void room.kick(player.seat);
			}
		};

		return { label: 'kick', run: kick };
	};

	// Invites: the table's link, the same one until the host resets it or it runs out (24 hours).
	let copied = $state(false);
	/** When the copied link stops working, as the player's local time. */
	let linkExpires = $state<string | null>(null);
	/** Shown to copy by hand when the browser blocks the clipboard. */
	let linkText = $state<string | null>(null);
	let shareNote = $state<string | null>(null);
	let sharing = $state(false);

	async function share(task: () => Promise<void>) {
		if (sharing) return;
		sharing = true;
		shareNote = null;

		try {
			await task();
		} catch (err) {
			shareNote = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		}

		sharing = false;
	}

	const copyLink = () =>
		share(async () => {
			const { token, expiresAt } = await createInvite(room.game, code);
			const link = `${location.origin}/invite/${token}`;
			linkExpires = new Date(expiresAt).toLocaleString(undefined, {
				weekday: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});

			try {
				await navigator.clipboard.writeText(link);
				linkText = null;
				copied = true;
				setTimeout(() => {
					copied = false;
				}, COPIED_NOTE_MS);
			} catch {
				// The browser blocked the clipboard: show the link to copy by hand.
				linkText = link;
			}
		});

	const resetLink = () =>
		share(async () => {
			await resetInviteLink(room.game, code);
			linkText = null;
			linkExpires = null;
			shareNote = 'The old link no longer works. Copy the new one to share it.';
		});
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
				action={hostAction(p)}
				onSit={p || tournament ? undefined : () => room.takeSeat(s)}
				onAddBot={!p && host ? () => room.addBot(s) : undefined}
			/>
		{/if}
	{/snippet}

	{#if tournament}
		<div class="flex flex-col items-center gap-1 text-center">
			<p class="label">Tournament table</p>
			<p class="text-sm text-paper/80">{tournament.name}</p>
		</div>
	{/if}
</Felt>

<div class="mt-6 flex flex-col items-center gap-3">
	{#if !tournament}
		<div class="flex flex-col items-center gap-1 text-center">
			<p class="label">Invite friends</p>
			<div class="flex flex-wrap justify-center">
				<button class="link-btn" onclick={copyLink} disabled={sharing}
					>{copied ? 'Link copied' : 'Copy invite link'}</button
				>
				{#if room.isHost}
					<button class="link-btn" onclick={resetLink} disabled={sharing}>Reset link</button>
				{/if}
			</div>
			{#if linkText}
				<label class="w-80 max-w-full text-left">
					<span class="label">Copy this link</span>
					<input
						class="field mt-1 text-sm"
						readonly
						value={linkText}
						onfocus={(e) => e.currentTarget.select()}
					/>
				</label>
			{/if}
			{#if linkExpires}
				<p class="text-xs text-paper/60">The link works for 24 hours, until {linkExpires}.</p>
			{/if}
			{#if shareNote}<p class="max-w-80 text-sm text-paper/80" role="status">{shareNote}</p>{/if}
		</div>
	{/if}
	{#if tournament}
		{#if tournament.closed}
			<p class="text-sm text-ember" role="status">
				Not enough players showed up, so this table is closed.
			</p>
		{:else if (room.startsAt ?? now) > now}
			<p class="text-sm text-paper/75" aria-live="off">
				Starts by itself in <span class="font-mono tabular-nums text-paper"
					>{countdown(room.startsAt)}</span
				>. {view.players.length} of {tournament.seats} players here.
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
			{canStart
				? `${view.players.length} players ready.`
				: `Needs at least ${minPlayers} players. Invite a friend, or press + on an empty seat to add a bot.`}
		</p>
	{:else}
		<p class="text-sm text-paper/75">
			Waiting for {view.players.find((p) => p.id === view.hostId)?.name ?? 'the host'} to start…
		</p>
	{/if}
</div>
