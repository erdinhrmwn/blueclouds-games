<script lang="ts">
	import type { BoardTable, TournamentBoard } from '#lib/server/platform.ts';
	import { avatarTone, coins, ordinal } from '#lib/tournament-formats.ts';

	/**
	 * A tournament's rounds side by side: one column per round, each table a card with its players and where they
	 * finished, and lines carrying each table's winner to their seat in the next round. Phones show one round at a
	 * time, with where each winner went written under their table.
	 */
	let {
		board,
		myId
	}: {
		board: TournamentBoard;
		myId: string | null;
	} = $props();

	const finished = $derived(!!board.tournament.endedAt);
	const isKnockout = $derived(
		board.tournament.format === null || board.tournament.format === 'knockout'
	);

	/**
	 * Rounds with their tables ordered so lines cross as little as possible: a later round's table sits next to the
	 * earliest table its players came from.
	 */
	const rounds = $derived.by(() => {
		const ordered: { round: number; startsAt: string; tables: BoardTable[] }[] = [];

		for (const round of board.rounds) {
			const previous = ordered.at(-1);
			const tableIndex = new Map<string, number>();
			previous?.tables.forEach((table, index) => {
				for (const seat of table.players) {
					tableIndex.set(seat.playerId, index);
				}
			});

			const feederOf = (table: BoardTable) =>
				Math.min(...table.players.map((seat) => tableIndex.get(seat.playerId) ?? Infinity));
			const tables = previous
				? [...round.tables].sort((a, b) => feederOf(a) - feederOf(b))
				: round.tables;

			ordered.push({ round: round.round, startsAt: round.startsAt, tables });
		}

		return ordered;
	});

	const lastRound = $derived(rounds.at(-1)?.round ?? 0);
	const champion = $derived(finished && isKnockout ? (board.standings[0] ?? null) : null);
	const championPrize = $derived(
		board.tournament.prizes.find((prize) => prize.place === 1) ?? null
	);

	function roundTitle(round: { round: number; tables: BoardTable[] }): string {
		const isFinal = isKnockout && round.round === lastRound && round.tables.length === 1;
		return isFinal ? 'Final' : `Stage ${round.round}`;
	}

	function tableState(table: BoardTable, startsAt: string): string {
		if (table.closeReason === 'not_enough_players') {
			return 'Didn’t start';
		}

		if (table.closedAt) {
			return 'Done';
		}

		if (table.startedAt) {
			return 'In play';
		}

		return Date.parse(startsAt) > Date.now() ? 'Not started' : 'Starting';
	}

	/** Seats at a table: the tournament's, or more when a later round seated its last players at a fuller one. */
	const seatsAt = (table: BoardTable) =>
		Math.max(board.tournament.playersPerRoom, table.players.length);

	function placeNote(placement: number | null, closed: boolean): string {
		if (placement === 1) {
			return 'won';
		}

		if (placement !== null) {
			return ordinal(placement);
		}

		return closed ? 'no-show' : '';
	}

	/** Where this round's winner sits next round, for the phone's note. */
	function nextSeat(round: number, playerId: string): string | null {
		const next = rounds.find((entry) => entry.round === round + 1);
		const table = next?.tables.find((entry) =>
			entry.players.some((seat) => seat.playerId === playerId)
		);
		if (!next || !table) {
			return null;
		}

		return `${roundTitle(next) === 'Final' ? 'the final' : `stage ${next.round}`} at ${table.code}`;
	}

	// Lines between columns, measured from the cards once they are laid out.
	let canvas = $state<HTMLDivElement>();
	let paths = $state<{ d: string; strong: boolean }[]>([]);
	let size = $state({ width: 0, height: 0 });

	function measure() {
		if (!canvas) {
			return;
		}

		const box = canvas.getBoundingClientRect();
		const point = (element: Element, side: 'left' | 'right') => {
			const rect = element.getBoundingClientRect();
			const x = (side === 'right' ? rect.right : rect.left) - box.left;
			return { x, y: rect.top + rect.height / 2 - box.top };
		};

		const lines: { d: string; strong: boolean }[] = [];
		for (const round of rounds) {
			for (const table of round.tables) {
				const winner = table.players.find((seat) => seat.placement === 1);
				if (!winner) {
					continue;
				}

				const from = canvas.querySelector(`[data-seat="${round.round}:${winner.playerId}"]`);
				const to =
					canvas.querySelector(`[data-seat="${round.round + 1}:${winner.playerId}"]`) ??
					(champion?.playerId === winner.playerId && round.round === lastRound
						? canvas.querySelector('[data-champion]')
						: null);
				if (!from || !to) {
					continue;
				}

				const start = point(from, 'right');
				const end = point(to, 'left');
				const middle = (start.x + end.x) / 2;
				lines.push({
					d: `M${start.x} ${start.y}H${middle}V${end.y}H${end.x}`,
					strong: winner.playerId === champion?.playerId
				});
			}
		}

		paths = lines;
		size = { width: box.width, height: box.height };
	}

	$effect(() => {
		if (!canvas) {
			return;
		}

		void rounds;
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(canvas);

		return () => observer.disconnect();
	});

	// Phones: one round at a time.
	let shownRound = $state<number | 'champion' | null>(null);
	const phoneRound = $derived(shownRound ?? (champion ? 'champion' : lastRound));
</script>

{#snippet tableCard(table: BoardTable, round: number, startsAt: string)}
	<article
		class="w-full rounded-xl border border-paper/12 bg-panel sm:w-56"
		aria-label="Table {table.code}"
	>
		<header class="flex items-baseline justify-between px-3 pt-2.5 pb-1.5">
			<span class="flex items-baseline gap-2">
				<span class="font-mono text-xs font-bold text-brass">{table.code}</span>
				<span class="text-[11px] text-paper/55 tabular-nums">
					{table.players.length}/{seatsAt(table)} seats
				</span>
			</span>
			<span class="text-[11px] text-paper/55">{tableState(table, startsAt)}</span>
		</header>
		<ol class="space-y-0.5 px-1 pb-1.5">
			{#each table.players as seat (seat.playerId)}
				{@const won = seat.placement === 1}
				{@const mine = seat.playerId === myId}
				<li
					data-seat="{round}:{seat.playerId}"
					class="flex items-center gap-2 rounded-lg px-2 py-1 text-sm {won
						? 'bg-brass/16'
						: ''} {mine ? 'ring-1 ring-brass/70' : ''}"
				>
					<span
						class="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-paper {avatarTone(
							seat.name
						)}"
						aria-hidden="true">{seat.name.charAt(0).toUpperCase()}</span
					>
					<span class="min-w-0 flex-1 truncate {won ? 'font-bold' : 'text-paper/75'}">
						{seat.name}{#if mine}<span class="text-brass">&nbsp;· you</span>{/if}{#if seat.bot}<span
								class="ml-1.5 rounded bg-paper/10 px-1.5 text-[10px] font-semibold text-paper/70"
								>bot</span
							>{/if}
					</span>
					<span class="text-xs {won ? 'font-bold text-brass' : 'text-paper/50'}"
						>{placeNote(seat.placement, !!table.closedAt)}</span
					>
				</li>
			{/each}
		</ol>
	</article>
{/snippet}

{#snippet championCard()}
	{#if champion}
		<div
			data-champion
			class="flex w-full flex-col items-center rounded-2xl border-[1.5px] border-brass/70 bg-brass/14 px-5 py-4 text-center sm:w-52"
		>
			<span class="text-xs font-semibold text-brass">Champion</span>
			<span
				class="mt-2 grid size-11 place-items-center rounded-full text-lg font-extrabold text-paper ring-2 ring-brass {avatarTone(
					champion.name
				)}"
				aria-hidden="true">{champion.name.charAt(0).toUpperCase()}</span
			>
			<span class="mt-2 font-display text-lg font-extrabold">{champion.name}</span>
			{#if championPrize}
				<span class="mt-0.5 text-xs text-paper/70">
					{championPrize.coins > 0 ? coins(championPrize.coins) : ''}{championPrize.extra
						? ` + ${championPrize.extra}`
						: ''}
				</span>
			{/if}
		</div>
	{/if}
{/snippet}

{#if rounds.length === 0}
	<p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
		The bracket shows once the tables are handed out.
	</p>
{:else}
	<!-- Wider screens: every round side by side, scrolling sideways when there are many. -->
	<div class="overflow-x-auto pb-2 max-sm:hidden">
		<div bind:this={canvas} class="relative flex w-max gap-14">
			<svg
				class="pointer-events-none absolute inset-0"
				width={size.width}
				height={size.height}
				aria-hidden="true"
			>
				{#each paths as path, index (index)}
					<path
						d={path.d}
						class="stroke-brass"
						fill="none"
						stroke-opacity={path.strong ? 0.9 : 0.35}
						stroke-width={path.strong ? 2 : 1.4}
						stroke-linejoin="round"
					/>
				{/each}
			</svg>
			{#each rounds as round (round.round)}
				<section class="relative flex flex-col" aria-label={roundTitle(round)}>
					<h3 class="mb-3 flex items-baseline justify-between gap-4">
						<span class="font-display text-base font-bold">{roundTitle(round)}</span>
						<span class="text-xs text-paper/55">
							{round.tables.length}
							{round.tables.length === 1 ? 'table' : 'tables'}
						</span>
					</h3>
					<div class="flex flex-1 flex-col justify-around gap-4">
						{#each round.tables as table (table.code)}
							{@render tableCard(table, round.round, round.startsAt)}
						{/each}
					</div>
				</section>
			{/each}
			{#if champion}
				<section class="relative flex flex-col" aria-label="Champion">
					<!-- A spacer as tall as the round titles, so the card lines up with the final. -->
					<div class="mb-3 h-6" aria-hidden="true"></div>
					<div class="flex flex-1 flex-col justify-around">{@render championCard()}</div>
				</section>
			{/if}
		</div>
	</div>

	<!-- Phones: one round at a time. -->
	<div class="sm:hidden">
		<div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Stages">
			{#each rounds as round (round.round)}
				<button
					role="tab"
					aria-selected={phoneRound === round.round}
					class="h-8 shrink-0 rounded-full px-4 text-sm {phoneRound === round.round
						? 'bg-brass font-bold text-ink'
						: 'bg-paper/8 text-paper/75'}"
					onclick={() => (shownRound = round.round)}>{roundTitle(round)}</button
				>
			{/each}
			{#if champion}
				<button
					role="tab"
					aria-selected={phoneRound === 'champion'}
					class="h-8 shrink-0 rounded-full px-4 text-sm {phoneRound === 'champion'
						? 'bg-brass font-bold text-ink'
						: 'bg-paper/8 text-paper/75'}"
					onclick={() => (shownRound = 'champion')}>Champion</button
				>
			{/if}
		</div>
		<div class="mt-4 space-y-4" role="tabpanel">
			{#if phoneRound === 'champion'}
				{@render championCard()}
			{:else}
				{#each rounds.filter((round) => round.round === phoneRound) as round (round.round)}
					{#each round.tables as table (table.code)}
						{@const winner = table.players.find((seat) => seat.placement === 1)}
						{@const next = winner ? nextSeat(round.round, winner.playerId) : null}
						<div>
							{@render tableCard(table, round.round, round.startsAt)}
							{#if winner && next}
								<p class="mt-1.5 px-2 text-xs font-semibold text-brass">
									→ {winner.name} plays {next}
								</p>
							{/if}
						</div>
					{/each}
				{/each}
			{/if}
		</div>
	</div>
{/if}
