<script lang="ts">
	import { ask } from '#lib/confirm.svelte.ts';
	import { untrack } from 'svelte';
	import { createInvite, resetInviteLink } from '#lib/platform.ts';
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import { clock } from '#lib/when.ts';
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
		if (!tournament || tournament.closed) {
			return;
		}

		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(tick);
	});

	/** "4:07" until a time, counting down with `now`. */
	const countdown = (until: number | null) => clock(Math.ceil(((until ?? now) - now) / 1000));

	const inSeat = (seat: number) => view.players.find((p) => p.seat === seat) ?? null;

	/** What the host can do to a seated player: remove a bot, or kick someone else (who can't come back). */
	const hostAction = (player: BaseView['players'][number] | null) => {
		if (!host || !player || player.id === room.playerId) {
			return undefined;
		}

		if (player.bot) {
			return { label: 'Remove', run: () => room.removeBot(player.id) };
		}

		const kick = async () => {
			const sure = await ask({
				title: `Kick ${player.name}?`,
				body: 'They leave the table and can’t come back to it.',
				action: 'Kick'
			});
			if (sure) {
				void room.kick(player.seat);
			}
		};

		return { label: 'Kick', run: kick };
	};

	// Invites: the table's link, the same one until the host resets it.
	let inviteLink = $state<string | null>(null);
	let linkBox = $state<HTMLDivElement>();
	let copied = $state(false);
	let shareNote = $state<string | null>(null);
	let sharing = $state(false);

	async function share(task: () => Promise<void>) {
		if (sharing) {
			return;
		}

		sharing = true;
		shareNote = null;

		try {
			await task();
		} catch (err) {
			shareNote = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		}

		sharing = false;
	}

	/** Asks for the table's live link; the platform makes one if there is none. */
	async function loadLink() {
		const { token } = await createInvite(room.game, code);
		inviteLink = `${location.origin}/invite/${token}`;
	}

	$effect(() => {
		if (tournament) {
			return;
		}

		// Untracked: `share` reads and writes `sharing`, which would re-run this effect.
		untrack(() => share(loadLink));
	});

	async function copyLink() {
		// The link failed to load earlier: try again before copying.
		if (!inviteLink) {
			await share(loadLink);
		}

		if (!inviteLink) {
			return;
		}

		try {
			await navigator.clipboard.writeText(inviteLink);
		} catch {
			// The browser blocked the clipboard: select the link so it can be copied by hand.
			if (linkBox) {
				window.getSelection()?.selectAllChildren(linkBox);
			}

			shareNote = 'Copying is blocked here. The link is selected, copy it yourself.';
			return;
		}

		shareNote = null;
		copied = true;
		setTimeout(() => {
			copied = false;
		}, COPIED_NOTE_MS);
	}

	const resetLink = () =>
		share(async () => {
			await resetInviteLink(room.game, code);
			await loadLink();
			shareNote = 'New link made. The old one no longer works.';
		});
</script>

<!-- Spot 0 is the dealer at the head of the table; chairs 1–6 follow clockwise. -->
<div class="shrink-0">
	<Felt count={seats + 1}>
		{#snippet seat(spot)}
			{#if spot === 0}
				<Dealer />
			{:else}
				{@const seatIndex = spot - 1}
				{@const player = inSeat(seatIndex)}
				<Seat
					{player}
					number={spot}
					isHost={!tournament && player?.id === view.hostId}
					isMe={player?.id === room.playerId}
					action={hostAction(player)}
					onSit={player || tournament ? undefined : () => room.takeSeat(seatIndex)}
					onAddBot={!player && host ? () => room.addBot(seatIndex) : undefined}
				/>
			{/if}
		{/snippet}

		<!-- The middle of the table: the host's Play button, or the tournament's countdown. -->
		<div class="flex w-full max-w-sm flex-col items-center gap-3 text-center wide:gap-4">
			{#if tournament}
				<div>
					<p class="text-xs text-paper/65 wide:text-sm">Tournament table</p>
					<p class="font-display text-lg leading-tight font-bold text-brass wide:text-2xl">
						{tournament.name}
					</p>
				</div>
				{#if tournament.closed}
					<p class="text-sm text-ember" role="status">
						Not enough players showed up, so this table is closed.
					</p>
				{:else if (room.startsAt ?? now) > now}
					<p class="font-display text-4xl font-black tabular-nums wide:text-6xl" aria-hidden="true">
						{countdown(room.startsAt)}
					</p>
					<p class="text-sm text-paper/75" aria-live="off">
						<span class="sr-only">Starts in {countdown(room.startsAt)}.</span>Starts by itself.
						{view.players.length} of {tournament.seats} players here.
					</p>
				{:else}
					<p class="font-display text-4xl font-black tabular-nums wide:text-6xl" aria-hidden="true">
						{countdown(room.waitEndsAt)}
					</p>
					<p class="text-sm text-paper/75" aria-live="off">
						Waiting for {tournament.seats - view.players.length} more.
						<span class="sr-only">Starts in {countdown(room.waitEndsAt)}</span> Starts with whoever is
						here.
					</p>
				{/if}
			{:else}
				{#if room.isHost}
					<button
						class="btn-brass w-full max-w-48"
						onclick={room.start}
						disabled={room.busy || !canStart}>Play</button
					>
					<p class="text-xs text-paper/75 wide:text-sm">
						{canStart
							? `${view.players.length} players ready.`
							: `Needs at least ${minPlayers} players. Invite a friend, or press + on an empty seat to add a bot.`}
					</p>
				{:else}
					<p class="text-sm text-paper/75">
						Waiting for {view.players.find((p) => p.id === view.hostId)?.name ?? 'the host'} to start…
					</p>
				{/if}
			{/if}
		</div>
	</Felt>
</div>

{#if !tournament}
	<!-- Inviting sits where your hand will be once the game starts, under a table of the same size. -->
	<div
		class="my-auto flex w-full max-w-md shrink-0 flex-col items-center gap-1.5 self-center text-center"
	>
		<p class="label">Invite friends</p>
		<!-- Tapping the link selects all of it, to copy by hand. -->
		<div
			class="w-full truncate rounded-md border border-paper/20 bg-black/35 px-3 py-2 font-mono text-xs select-all wide:px-4 wide:py-2.5 wide:text-sm"
			bind:this={linkBox}
		>
			{#if inviteLink}
				{inviteLink}
			{:else}
				<span class="text-paper/55">{sharing ? 'Making a link…' : 'No link yet'}</span>
			{/if}
		</div>
		<div class="flex flex-wrap justify-center">
			<button class="link-btn" onclick={copyLink} disabled={sharing}
				>{copied ? 'Link copied' : 'Copy link'}</button
			>
			{#if room.isHost}
				<button class="link-btn" onclick={resetLink} disabled={sharing}>Reset link</button>
			{/if}
		</div>
		{#if shareNote}
			<p class="text-xs text-paper/80 wide:text-sm" role="status">{shareNote}</p>
		{/if}
	</div>
{/if}
