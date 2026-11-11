<script lang="ts">
	import { countdown } from '#lib/motion.ts';

	/** What any game shows about a player in a seat. */
	type SeatPlayer = { id: string; name: string; lives: number; cards: number; bot: boolean };

	let {
		player,
		isTurn = false,
		isHost = false,
		isMe = false,
		lives = 3,
		timeLeft = null,
		drain = null,
		action
	}: {
		player: SeatPlayer | null;
		isTurn?: boolean;
		isHost?: boolean;
		isMe?: boolean;
		lives?: number;
		/** Share of the turn timer left (1 → 0), or null when no timer runs for this seat. */
		timeLeft?: number | null;
		/** Time left when this deadline arrived; the ring animates down from it. */
		drain?: { ms: number; total: number } | null;
		action?: { label: string; run: () => void };
	} = $props();

	const out = $derived(!!player && player.lives === 0);
	// Bots share the "Bot" prefix, so use their last word for the monogram.
	const initial = $derived((player?.bot ? player.name.trim().split(/\s+/).at(-1) : player?.name.trim())?.charAt(0).toUpperCase() ?? '');
</script>

{#if player}
	<div data-seat={player.id} class="flex w-24 flex-col items-center gap-1 text-center sm:w-28 {out ? 'opacity-40 grayscale' : ''}">
		<div class="relative">
			{#if player.cards > 0 && !out}
				<!-- face-down hand peeking over the chair -->
				<div class="absolute -top-3 left-1/2 flex -translate-x-1/2" aria-hidden="true">
					{#each Array(player.cards) as _, i (i)}
						<span class="card-back -mx-1 block h-6 w-4" style="transform: rotate({(i - (player.cards - 1) / 2) * 12}deg)"></span>
					{/each}
				</div>
			{/if}
			<div
				class="relative grid size-12 place-items-center rounded-full border-2 font-display text-xl font-bold sm:size-14
					{isTurn ? 'turn border-brass bg-brass text-ink' : 'border-rim-light bg-[#2a1d13] text-paper'}"
			>
				{initial}
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
				{#if player.bot}
					<span class="absolute -right-1.5 -bottom-1 rounded-sm bg-paper px-1 text-[10px] font-semibold text-ink">bot</span>
				{/if}
			</div>
		</div>
		<div class="max-w-full truncate rounded-sm bg-black/45 px-2 py-0.5 text-xs font-medium">
			{player.name}{#if isMe}<span class="text-paper/75">&nbsp;(you)</span>{/if}
		</div>
		<div class="flex items-center gap-1" aria-label="{player.lives} of {lives} lives">
			{#each Array(lives) as _, i (i)}
				<span class="size-2 rounded-full {i < player.lives ? 'bg-ember' : 'border border-paper/60'}"></span>
			{/each}
			{#if isHost}<span class="ml-1 text-[11px] font-semibold text-brass">host</span>{/if}
		</div>
		{#if action}
			<button class="link-btn -my-2 text-xs" onclick={action.run}>
				{action.label}
			</button>
		{/if}
	</div>
{:else}
	<div class="flex w-24 flex-col items-center gap-1 sm:w-28" aria-label="Empty seat">
		<div class="size-12 rounded-full border-2 border-dashed border-paper/40 sm:size-14"></div>
		<div class="text-xs text-paper/60">empty seat</div>
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
