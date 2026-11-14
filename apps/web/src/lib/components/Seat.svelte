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
		badge,
		meter,
		summary,
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
		/** The game's quick status on the avatar's bottom right corner (lives, cards in hand). */
		badge?: Snippet;
		/** A game's gauge under the name plate (Cloudburst's cloud meter). */
		meter?: Snippet;
		/** What the badge and meter show, in words for screen readers ("2 of 3 lives"). */
		summary?: string;
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
	} = $props();

	const initial = $derived(player?.name.trim().charAt(0).toUpperCase() ?? '');

	/** Knocked out: the whole seat greys. Away fades the avatar's letter and the badge; the plate shows a moon. */
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

		if (summary) {
			parts.push(summary);
		}

		return parts.join(', ');
	});
</script>

{#if player}
	<!-- A compact seat: the avatar, the name plate tucked under it, the game's status on the avatar's corner and any
		 meter under the plate. Short, so the felt keeps its height. -->
	<div
		data-seat={player.id}
		class="flex w-24 flex-col items-center text-center wide:w-32 {outClass}"
		role="group"
		aria-label={seatLabel}
	>
		<div class="relative">
			<div
				class="avatar relative grid size-12 place-items-center rounded-xl border-2 font-display text-lg font-bold wide:size-14 wide:rounded-[14px] wide:text-xl
					{avatarLook}"
				aria-hidden="true"
			>
				{#if player.bot}
					<!-- robot head: bots get an icon instead of a monogram -->
					<svg
						viewBox="0 0 24 24"
						class="size-6 wide:size-7 {awayFade}"
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
					<span class={awayFade}>{initial}</span>
				{/if}
				{#if timeLeft !== null}
					<!-- The timer runs on the avatar's own edge, so the seat on turn is no bigger than the others.
						 It follows the rounded square clockwise from the top middle: its 14px corners are 10 of the 40 units here. -->
					<svg
						class="pointer-events-none absolute -inset-0.5 size-12 wide:size-14"
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
			<!-- Every mark has one fixed spot, so none can meet another: Host on the top left corner, the game's badge on
				 the top right (the host's × takes that corner only in the lobby, where no game has a badge), Away and VIP
				 in the name plate. -->
			{#if isHost}
				<span class="seat-tag -top-2 -left-2 bg-brass text-ink" aria-hidden="true">Host</span>
			{/if}
			{#if badge}
				<span class="seat-badge -top-2 -right-3 {awayFade}" aria-hidden="true">
					{@render badge()}
				</span>
			{/if}
			{#if action}
				{@render cornerButton(`${action.label} ${player.name}`, action.run, 'remove')}
			{/if}
		</div>
		<div
			class="plate relative -mt-1.5 flex {isMe
				? 'mine'
				: ''} max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[11px] leading-4 font-semibold wide:text-xs wide:leading-5
				{isTurn ? 'bg-brass text-ink' : 'bg-[#120e0b] text-paper'}"
			aria-hidden="true"
		>
			{#if player.away}
				<!-- moon -->
				<svg viewBox="0 0 24 24" class="size-3 shrink-0 opacity-80" fill="currentColor">
					<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
				</svg>
			{/if}
			{#if player.vip}
				<span
					class="shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] font-bold {isTurn
						? 'bg-ink text-brass'
						: 'bg-brass text-ink'}">VIP</span
				>
			{/if}
			<span class="min-w-0 truncate {player.away && !isTurn ? 'text-paper/70' : ''}"
				>{player.name}</span
			>
		</div>
		{#if meter}
			<div class="mt-1 {awayFade}" aria-hidden="true">
				{@render meter()}
			</div>
		{/if}
	</div>
{:else}
	<div
		class="flex w-24 flex-col items-center wide:w-32"
		role="group"
		aria-label="Seat {number ?? ''}, empty"
	>
		<!-- The chair itself is the main button: sit down here. The host adds a bot with the small + on its corner. -->
		<div class="relative">
			{#if onSit}
				<button
					class="grid size-12 place-items-center rounded-xl border-2 border-dashed wide:size-14 wide:rounded-[14px] border-paper/40 text-paper/60 transition hover:border-solid hover:border-brass/70 hover:bg-brass/10 hover:text-brass"
					onclick={onSit}
					aria-label="Sit in seat {number ?? ''}"
					title="Sit here"
				>
					{@render sitIcon('size-5 wide:size-6')}
				</button>
			{:else}
				<div
					class="size-12 rounded-xl border-2 border-dashed border-paper/40 wide:size-14 wide:rounded-[14px]"
				></div>
			{/if}
			{#if onAddBot}
				{@render cornerButton(`Add a bot to seat ${number ?? ''}`, onAddBot, 'add')}
			{/if}
		</div>
		<div class="mt-1 text-[11px] text-paper/70 wide:text-xs">Seat {number ?? ''}</div>
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
	.plate {
		box-shadow:
			0 0 0 1px rgb(210 165 76 / 0.35),
			0 2px 4px rgb(0 0 0 / 0.4);
	}
	/* Your own seat: a solid brass edge on the plate, in place of a "(you)" that would crowd the name. */
	.plate.mine {
		box-shadow:
			0 0 0 1.5px var(--color-brass),
			0 2px 4px rgb(0 0 0 / 0.4);
	}
	.seat-badge {
		position: absolute;
		z-index: 10;
		display: inline-flex;
		height: 1.125rem;
		align-items: center;
		gap: 0.125rem;
		border-radius: 9999px;
		background: #120e0b;
		padding-inline: 0.3125rem;
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		box-shadow:
			0 0 0 1px rgb(243 234 214 / 0.25),
			0 0 0 3px var(--color-felt-deep);
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
	@media (prefers-reduced-motion: reduce) {
		.turn {
			animation: none;
		}
	}
</style>
