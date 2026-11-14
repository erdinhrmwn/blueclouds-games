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
		onAddBot,
		cards = 0,
		cardSide = 'right'
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
		/** A host's action on this seat (remove a bot, kick a player): a small × on the avatar's corner. */
		action?: { label: string; run: () => void };
		/** Chair number shown to people (1-based). */
		number?: number;
		/** Empty chair only: move yourself here. */
		onSit?: () => void;
		/** Empty chair only (host): put a bot here. */
		onAddBot?: () => void;
		/** Cards this player holds, drawn as backs beside the avatar (count stays in the status line). */
		cards?: number;
		/** Which side of the avatar the backs fan out on: towards the middle of the table. */
		cardSide?: 'left' | 'right';
	} = $props();

	/** Fan at most this many backs; more would only crowd the next chair. */
	const MAX_BACKS = 5;
	const backs = $derived(Math.min(cards, MAX_BACKS));

	const initial = $derived(player?.name.trim().charAt(0).toUpperCase() ?? '');

	/** Knocked out: the whole seat greys. Away fades the status and the avatar's letter, so the Away tag stays readable. */
	const outClass = $derived(out ? 'opacity-40 grayscale' : '');
	const awayFade = $derived(player?.away ? 'opacity-50' : '');

	/** Every avatar keeps the same full-strength edge, so none looks smaller than the rest. */
	const avatarLook = $derived.by(() => {
		if (isTurn) {
			return 'turn border-brass bg-brass text-ink';
		}

		if (player?.away) {
			return 'border-dashed border-paper/70 bg-[#2a1d13] text-paper/45';
		}

		return 'border-rim-light bg-[#2a1d13] text-paper';
	});

	/** One label for screen readers; the avatar and tags are hidden from them. */
	const seatLabel = $derived.by(() => {
		if (!player) {
			return '';
		}

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
		class="flex w-20 flex-col items-center gap-1 text-center sm:w-28 {outClass}"
		role="group"
		aria-label={seatLabel}
	>
		<!-- Room below for the Away tag, kept on every seat so all their lines stay level. -->
		<div class="relative mb-1.5">
			<div
				class="relative grid size-12 place-items-center rounded-xl border-2 font-display text-lg font-bold sm:size-14 sm:rounded-[14px] sm:text-xl
					{avatarLook}"
				aria-hidden="true"
			>
				{#if player.bot}
					<!-- robot head: bots get an icon instead of a monogram -->
					<svg
						viewBox="0 0 24 24"
						class="size-6 sm:size-7"
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
					<!-- The timer runs on the avatar's own edge, so the seat on turn is no bigger than the others.
						 It follows the rounded square clockwise from the top middle: its 14px corners are 10 of the 40 units here. -->
					<svg
						class="pointer-events-none absolute -inset-0.5 size-12 sm:size-14"
						viewBox="0 0 40 40"
						aria-hidden="true"
					>
						<path
							d="M20 1 H30 A9 9 0 0 1 39 10 V30 A9 9 0 0 1 30 39 H10 A9 9 0 0 1 1 30 V10 A9 9 0 0 1 10 1 Z"
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
			<!-- Every mark has one fixed spot, so none can meet another: Host on the top left corner, the host's ×
				 (or + on an empty chair) on the top right, Away on the bottom edge, VIP in the name tag below.
				 The ring cuts a gap where a tag crosses the edge or the timer. -->
			{#if isHost}
				<span class="seat-tag -top-2 -left-1.5 bg-brass text-ink" aria-hidden="true">Host</span>
			{/if}
			{#if player.away}
				<span
					class="seat-tag -bottom-2 left-1/2 -translate-x-1/2 bg-paper text-ink"
					aria-hidden="true"
				>
					<!-- moon -->
					<svg viewBox="0 0 24 24" class="size-2.5" fill="currentColor">
						<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
					</svg>
					Away
				</span>
			{/if}
			{#if action}
				{@render cornerButton(`${action.label} ${player.name}`, action.run, 'remove')}
			{/if}
			{#if backs > 0}
				<div
					class="backs pointer-events-none absolute top-1/2 -translate-y-1/2 {cardSide === 'right'
						? 'left-full ml-1'
						: 'right-full mr-1'}"
					aria-hidden="true"
				>
					{#each Array(backs) as _, index (index)}
						{@const step = cardSide === 'right' ? 1 : -1}
						<span
							class="card-back absolute top-0 h-[1.375rem] w-4 sm:h-7 sm:w-5"
							style="{cardSide === 'right' ? 'left' : 'right'}: {index * 4}px; rotate: {step *
								(6 + index * 6)}deg"
						></span>
					{/each}
				</div>
			{/if}
		</div>
		<div
			class="flex max-w-full items-center gap-1 rounded-sm bg-black/45 px-1.5 py-0.5 text-[11px] font-medium sm:px-2 sm:text-xs
				{player.away ? 'text-paper/70' : ''}"
			aria-hidden="true"
		>
			{#if player.vip}
				<span
					class="shrink-0 rounded-[3px] bg-brass px-1 text-[9px] leading-[14px] font-bold text-ink"
					>VIP</span
				>
			{/if}
			<span class="min-w-0 truncate"
				>{player.name}{#if isMe}<span class="text-paper/75">&nbsp;(you)</span>{/if}</span
			>
		</div>
		{#if status}
			<div class="flex items-center gap-1 {awayFade}">
				{@render status()}
			</div>
		{/if}
	</div>
{:else}
	<div
		class="flex w-20 flex-col items-center gap-1 sm:w-28"
		role="group"
		aria-label="Seat {number ?? ''}, empty"
	>
		<!-- The chair itself is the main button: sit down here. The host adds a bot with the small + on its corner. -->
		<div class="relative mb-1.5">
			{#if onSit}
				<button
					class="grid size-12 place-items-center rounded-xl border-2 border-dashed sm:size-14 sm:rounded-[14px] border-paper/40 text-paper/60 transition hover:border-solid hover:border-brass/70 hover:bg-brass/10 hover:text-brass"
					onclick={onSit}
					aria-label="Sit in seat {number ?? ''}"
					title="Sit here"
				>
					{@render sitIcon('size-5 sm:size-6')}
				</button>
			{:else}
				<div
					class="size-12 rounded-xl border-2 border-dashed border-paper/40 sm:size-14 sm:rounded-[14px]"
				></div>
			{/if}
			{#if onAddBot}
				{@render cornerButton(`Add a bot to seat ${number ?? ''}`, onAddBot, 'add')}
			{/if}
		</div>
		<div class="text-[11px] text-paper/70 sm:text-xs">Seat {number ?? ''}</div>
	</div>
{/if}

<!-- An arrow going into the chair. -->
{#snippet sitIcon(size: string)}
	<svg
		viewBox="0 0 20 20"
		class={size}
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M12 4h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M7 14l4-4-4-4M11 10H3" />
	</svg>
{/snippet}

<!-- A small round button on the avatar's top right corner, with a full 44px tap area around it. -->
{#snippet cornerButton(label: string, run: () => void, kind: 'remove' | 'add')}
	<button
		class="corner group absolute -top-[1.375rem] -right-[1.375rem] z-20 grid size-11 place-items-center"
		onclick={run}
		aria-label={label}
		title={label}
	>
		<span
			class="grid size-6 place-items-center rounded-full border transition
				{kind === 'remove'
				? 'border-paper/40 bg-ink text-paper/85 group-hover:border-ember group-hover:bg-ember group-hover:text-paper'
				: 'border-brass bg-brass text-ink group-hover:brightness-110'}"
		>
			{#if kind === 'remove'}
				<svg
					viewBox="0 0 20 20"
					class="size-3"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M5 5l10 10M15 5 5 15" />
				</svg>
			{:else}
				<svg
					viewBox="0 0 20 20"
					class="size-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M10 4.5v11M4.5 10h11" />
				</svg>
			{/if}
		</span>
	</button>
{/snippet}

<style>
	.corner > span {
		box-shadow: 0 0 0 2px var(--color-felt-deep);
	}
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
	/* The turn pulse brightens the avatar inside its own edge, so the seat keeps its size. */
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
	.backs {
		width: 2.5rem;
		height: 1.75rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.turn {
			animation: none;
		}
	}
</style>
