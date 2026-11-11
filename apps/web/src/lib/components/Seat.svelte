<script lang="ts">
	import { countdown } from '#lib/motion.ts';
	import type { Snippet } from 'svelte';

	/** What any game shows about a player in a seat. */
	type SeatPlayer = { id: string; name: string; bot: boolean; away?: boolean };

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
</script>

{#if player}
	<div data-seat={player.id} class="flex w-24 flex-col items-center gap-1 text-center sm:w-28 {out ? 'opacity-40 grayscale' : player.away ? 'opacity-60' : ''}">
		<div class="relative">
			<div
				class="relative grid size-12 place-items-center rounded-full border-2 font-display text-xl font-bold sm:size-14
					{isTurn ? 'turn border-brass bg-brass text-ink' : 'border-rim-light bg-[#2a1d13] text-paper'}"
			>
				{#if player.bot}
					<!-- robot head: bots get an icon instead of a monogram -->
					<svg viewBox="0 0 24 24" class="size-6 sm:size-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Bot">
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
					<svg class="pointer-events-none absolute -inset-1.5 size-[calc(100%+0.75rem)] -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
						<circle
							cx="20"
							cy="20"
							r="18.5"
							fill="none"
							stroke={timeLeft < 0.25 ? 'var(--color-ember)' : 'var(--color-paper)'}
							stroke-width="2"
							stroke-linecap="round"
							pathLength="100"
							stroke-dasharray="100"
							class="ring"
							use:countdown={drain && { ...drain, kind: 'ring' }}
						/>
					</svg>
				{/if}
				{#if player.away}
					<span class="absolute -right-2 -bottom-1 rounded-sm bg-paper px-1 text-[10px] font-semibold text-ink">away</span>
				{/if}
			</div>
		</div>
		<div class="max-w-full truncate rounded-sm bg-black/45 px-2 py-0.5 text-xs font-medium">
			{player.name}{#if isMe}<span class="text-paper/75">&nbsp;(you)</span>{/if}
		</div>
		{#if status || isHost}
			<div class="flex items-center gap-1">
				{@render status?.()}
				{#if isHost}<span class="ml-1 text-[11px] font-semibold text-brass">host</span>{/if}
			</div>
		{/if}
		{#if action}
			<button class="link-btn -my-2 text-xs" onclick={action.run}>
				{action.label}
			</button>
		{/if}
	</div>
{:else}
	<div class="flex w-24 flex-col items-center gap-1 sm:w-28" role="group" aria-label="Seat {number ?? ''}, empty">
		{#if onAddBot}
			<button
				class="grid size-12 place-items-center rounded-full border-2 border-dashed border-brass/70 text-2xl leading-none text-brass transition hover:border-solid hover:bg-brass/10 disabled:opacity-40 sm:size-14"
				onclick={onAddBot}
				aria-label="Add a bot to seat {number ?? ''}">+</button
			>
		{:else}
			<div class="size-12 rounded-full border-2 border-dashed border-paper/40 sm:size-14"></div>
		{/if}
		<div class="text-xs text-paper/70">Seat {number ?? ''}</div>
		{#if onSit}
			<button class="link-btn -my-2 text-xs" onclick={onSit}>Sit here</button>
		{/if}
	</div>
{/if}

<style>
	.turn {
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgb(210 165 76 / 0.6);
		}
		50% {
			box-shadow: 0 0 0 10px rgb(210 165 76 / 0);
		}
	}
	.ring {
		transition: stroke 300ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.turn {
			animation: none;
			box-shadow: 0 0 0 4px rgb(210 165 76 / 0.5);
		}
	}
</style>
