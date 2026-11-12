<script lang="ts">
	import { countdown } from '#lib/motion.ts';
	import type { Snippet } from 'svelte';

	/** What any game shows about a player in a seat. */
	type SeatPlayer = { id: string; name: string; bot: boolean; away?: boolean; vip?: boolean };

	let {
		player,
		isTurn = false,
		isHost = false,
		isMe = false,
		out = false,
		status,
		timeLeft = null,
		drain = null,
		action,
		number,
		onSit,
		onAddBot
	}: {
		player: SeatPlayer | null;
		isTurn?: boolean;
		isHost?: boolean;
		isMe?: boolean;
		/** Knocked out of the game: the seat is greyed. */
		out?: boolean;
		/** The game's own line under the name (lives, cards, points). */
		status?: Snippet;
		/** Share of the turn timer left (1 → 0), or null when no timer runs for this seat. */
		timeLeft?: number | null;
		/** Time left when this deadline arrived; the ring animates down from it. */
		drain?: { ms: number; total: number } | null;
		action?: { label: string; run: () => void };
		/** Chair number shown to people (1-based). */
		number?: number;
		/** Empty chair only: move yourself here. */
		onSit?: () => void;
		/** Empty chair only (host): put a bot here. */
		onAddBot?: () => void;
	} = $props();

	const initial = $derived(player?.name.trim().charAt(0).toUpperCase() ?? '');

	/** Knocked out: the whole seat greys. Away fades the status and the avatar's letter, so the Away tag stays readable. */
	const outClass = $derived(out ? 'opacity-40 grayscale' : '');
	const awayFade = $derived(player?.away ? 'opacity-50' : '');

	/** Every avatar keeps the same full-strength edge, so none looks smaller than the rest. */
	const avatarLook = $derived.by(() => {
		if (isTurn) return 'turn border-brass bg-brass text-ink';
		if (player?.away) return 'border-dashed border-paper/70 bg-[#2a1d13] text-paper/45';
		return 'border-rim-light bg-[#2a1d13] text-paper';
	});

	/** One label for screen readers; the avatar and tags are hidden from them. */
	const seatLabel = $derived.by(() => {
		if (!player) return '';

		const parts = [isMe ? `${player.name} (you)` : player.name];
		if (number) {
			parts.unshift(`Seat ${number}`);
		}
		if (isHost) {
			parts.push('host');
		}
		if (player.vip) {
			parts.push('VIP');
		}
		if (player.bot) {
			parts.push('bot');
		}
		if (player.away) {
			parts.push('away');
		}

		return parts.join(', ');
	});
</script>

{#if player}
	<div
		data-seat={player.id}
		class="flex w-24 flex-col items-center gap-1 text-center sm:w-28 {outClass}"
		role="group"
		aria-label={seatLabel}
	>
		<!-- Room below for the Away tag, kept on every seat so all their lines stay level. -->
		<div class="relative mb-1.5" aria-hidden="true">
			<div
				class="relative grid size-16 place-items-center rounded-full border-2 font-display text-2xl font-bold
					{avatarLook}"
			>
				{#if player.bot}
					<!-- robot head: bots get an icon instead of a monogram -->
					<svg
						viewBox="0 0 24 24"
						class="size-8"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M12 3v3" />
						<circle cx="12" cy="2.6" r="0.9" fill="currentColor" stroke="none" />
						<rect x="4.5" y="6.5" width="15" height="12" rx="3" />
						<circle cx="9.3" cy="11.8" r="1.4" fill="currentColor" stroke="none" />
						<circle cx="14.7" cy="11.8" r="1.4" fill="currentColor" stroke="none" />
						<path d="M9.5 15.5h5" />
						<path d="M2.8 11v3.5M21.2 11v3.5" />
					</svg>
				{:else}
					{initial}
				{/if}
				{#if timeLeft !== null}
					<!-- The timer runs on the avatar's own edge, so the seat on turn is no bigger than the others. -->
					<svg
						class="pointer-events-none absolute -inset-0.5 size-16 -rotate-90"
						viewBox="0 0 40 40"
						aria-hidden="true"
					>
						<circle
							cx="20"
							cy="20"
							r="19"
							fill="none"
							stroke={timeLeft < 0.25 ? 'var(--color-ember)' : 'var(--color-paper)'}
							stroke-width="2"
							stroke-linecap="round"
							pathLength="100"
							stroke-dasharray="100"
							class="ring"
							use:countdown={drain}
						/>
					</svg>
				{/if}
			</div>
			<!-- Roles on the top edge (Host left, VIP right), away at the bottom middle. The ring cuts a gap over the avatar and timer. -->
			{#if isHost}
				<span class="seat-tag -top-2 -left-3.5 bg-brass text-ink">Host</span>
			{/if}
			{#if player.vip}
				<span class="seat-tag -top-2 -right-3.5 border border-brass/70 bg-ink text-brass">VIP</span>
			{/if}
			{#if player.away}
				<span class="seat-tag -bottom-2 left-1/2 -translate-x-1/2 bg-paper text-ink">
					<!-- moon -->
					<svg viewBox="0 0 24 24" class="size-2.5" fill="currentColor">
						<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
					</svg>
					Away
				</span>
			{/if}
		</div>
		<div
			class="max-w-full truncate rounded-sm bg-black/45 px-2 py-0.5 text-xs font-medium
				{player.away ? 'text-paper/70' : ''}"
			aria-hidden="true"
		>
			{player.name}{#if isMe}<span class="text-paper/75">&nbsp;(you)</span>{/if}
		</div>
		{#if status}
			<div class="flex items-center gap-1 {awayFade}">
				{@render status()}
			</div>
		{/if}
		{#if action}
			<button class="link-btn -my-2 text-xs" onclick={action.run}>
				{action.label}
			</button>
		{/if}
	</div>
{:else}
	<div
		class="flex w-24 flex-col items-center gap-1 sm:w-28"
		role="group"
		aria-label="Seat {number ?? ''}, empty"
	>
		{#if onAddBot}
			<button
				class="mb-1.5 grid size-16 place-items-center rounded-full border-2 border-dashed border-brass/70 text-2xl leading-none text-brass transition hover:border-solid hover:bg-brass/10 disabled:opacity-40"
				onclick={onAddBot}
				aria-label="Add a bot to seat {number ?? ''}">+</button
			>
		{:else}
			<div class="mb-1.5 size-16 rounded-full border-2 border-dashed border-paper/40"></div>
		{/if}
		<div class="text-xs text-paper/70">Seat {number ?? ''}</div>
		{#if onSit}
			<button class="link-btn -my-2 text-xs" onclick={onSit}>Sit here</button>
		{/if}
	</div>
{/if}

<style>
	.seat-tag {
		position: absolute;
		z-index: 10;
		display: inline-flex;
		height: 1.125rem;
		align-items: center;
		gap: 0.125rem;
		border-radius: 9999px;
		padding-inline: 0.375rem;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		box-shadow: 0 0 0 2px var(--color-felt-deep);
	}
	/* The turn pulse brightens the avatar inside its own edge, so the seat stays 64px. */
	.turn {
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			filter: brightness(1);
		}
		50% {
			filter: brightness(1.2);
		}
	}
	.ring {
		transition: stroke 300ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.turn {
			animation: none;
		}
	}
</style>
