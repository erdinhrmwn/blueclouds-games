<script lang="ts">
	import { fetchStandings, type LiveTournament, type Standing } from '#lib/platform.ts';
	import { enterTable } from '#lib/tables.ts';
	import {
		coins,
		FORMATS,
		ordinal,
		ranFor,
		ranksByPoints,
		startsIn
	} from '#lib/tournament-formats.ts';
	import { when } from '#lib/when.ts';
	import StandingsList from './StandingsList.svelte';
	import TournamentFelt from './TournamentFelt.svelte';

	/**
	 * A playing or finished tournament's Detail: the round and when it starts (or who won) on the felt, the viewer's
	 * own place and table, then the standings, or the podium and the final places.
	 */
	let {
		open = $bindable(false),
		tournament,
		game,
		back,
		now,
		onwithdraw
	}: {
		open?: boolean;
		tournament: LiveTournament | null;
		game: string;
		back: string;
		/** The lobby's clock, for the countdown. */
		now: number;
		/** Gives up a seat whose table hasn't started; the lobby asks first. */
		onwithdraw: (tournament: LiveTournament) => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let standings = $state<Standing[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (!dialog) return;

		if (open && !dialog.open) {
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	// Fresh standings every time it opens.
	$effect(() => {
		if (!open || !tournament) {
			return;
		}

		void load(tournament.id);
	});

	async function load(id: string) {
		loading = true;
		error = null;

		try {
			standings = (await fetchStandings(id)).standings;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load the standings.';
		} finally {
			loading = false;
		}
	}

	const finished = $derived(!!tournament?.endedAt);
	const byPoints = $derived(ranksByPoints(tournament?.format ?? null));
	const format = $derived(tournament?.format ? FORMATS[tournament.format] : null);

	const roundLabel = $derived.by(() => {
		if (!tournament) return '';
		if (finished) return 'Finished';
		if (!byPoints) return `Round ${tournament.round}`;

		return `Round ${tournament.round} of ${tournament.rounds ?? 3}`;
	});

	const headline = $derived.by(() => {
		if (!tournament) return '';

		if (finished) {
			const winner = standings[0] ?? tournament.top[0];
			return winner ? `${winner.name} wins` : 'No winner';
		}

		if (tournament.roundStarted) {
			return `Round ${tournament.round} in play`;
		}

		return startsIn(tournament.roundStartsAt, now);
	});

	const prizeOf = (place: number) => tournament?.prizes.find((prize) => prize.place === place);

	/** Podium order: 2nd, 1st, 3rd, so the winner stands in the middle. */
	const PODIUM = [2, 1, 3];
	const PODIUM_HEIGHT: Record<number, string> = { 1: 'h-24', 2: 'h-16', 3: 'h-12' };
	const MEDAL_TONE: Record<number, string> = {
		1: 'border-brass/50 bg-brass/15 text-brass',
		2: 'border-paper/40 bg-paper/10 text-paper',
		3: 'border-rim-light/60 bg-rim-light/15 text-paper'
	};

	const me = $derived(tournament?.me ?? null);

	/** "You're 3rd · 9 points", "You're in round 2", "You're out · 6th". */
	const meLine = $derived.by(() => {
		if (!tournament || !me) return null;

		if (byPoints) {
			return `You’re ${ordinal(me.place)} · ${me.points} points`;
		}

		if (!finished && tournament.table) {
			return `You’re in round ${tournament.round}`;
		}

		return finished ? `You finished ${ordinal(me.place)}` : `You’re out · ${ordinal(me.place)}`;
	});

	const tableLine = $derived.by(() => {
		const table = tournament?.table;
		if (!tournament || !table || finished) return null;
		if (table.closed) return `Your round ${tournament.round} table ${table.code} is done`;
		if (table.started) return `Your round ${tournament.round} table ${table.code} is in play`;

		return `Round ${tournament.round} table ${table.code}, ${startsIn(tournament.roundStartsAt, now).toLowerCase()}`;
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="live-title"
	class="modal max-h-[calc(100dvh-2rem)] overflow-hidden p-0 open:flex open:flex-col sm:w-[min(36rem,calc(100%-2rem))]"
>
	{#if tournament}
		<TournamentFelt
			label={roundLabel}
			dot={finished ? 'bg-brass' : 'bg-paper'}
			startsAt={finished
				? (tournament.endedAt ?? tournament.roundStartsAt)
				: tournament.roundStartsAt}
			countdown={headline}
			{back}
		>
			<button
				type="button"
				class="grid size-9 place-items-center rounded-lg bg-room/85 text-paper ring-1 ring-paper/15 hover:ring-paper/40"
				onclick={() => (open = false)}
				aria-label="Close"
			>
				<svg
					viewBox="0 0 20 20"
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M5 5l10 10M15 5 5 15" />
				</svg>
			</button>
		</TournamentFelt>

		<div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
			<div>
				<h2 id="live-title" class="modal-title">{tournament.name}</h2>
				<p class="mt-2 flex flex-wrap items-center gap-2 text-sm text-paper/60">
					{#if format}
						<span
							class="rounded-md border border-brass/55 px-1.5 py-0.5 text-xs font-bold text-brass"
							>{format.label}</span
						>
					{/if}
					{tournament.players} players
					{#if finished && tournament.endedAt}
						· ran {ranFor(tournament.startsAt, tournament.endedAt)}
					{/if}
				</p>
			</div>

			{#if meLine}
				<section
					class="flex flex-wrap items-center gap-3 rounded-xl border border-brass/35 bg-black/30 px-4 py-3"
					aria-label="Your place"
				>
					<div class="min-w-0 flex-1">
						<p class="font-bold">{meLine}</p>
						{#if tableLine}<p class="mt-0.5 text-sm text-paper/65">{tableLine}</p>{/if}
					</div>
					{#if tournament.table && !tournament.table.started && !finished}
						<button class="btn-ghost h-10 rounded-xl" onclick={() => onwithdraw(tournament!)}
							>Withdraw</button
						>
					{/if}
					{#if tournament.table && !tournament.table.closed && !finished}
						<button
							class="btn-brass h-10 rounded-xl"
							onclick={() => (error = enterTable(game, tournament.table!.code))}>Go to table</button
						>
					{/if}
				</section>
			{/if}

			{#if finished && tournament.prizes.length > 0}
				<p class="text-sm {tournament.prizesPaid ? 'text-go' : 'text-brass'}">
					{tournament.prizesPaid
						? 'Prizes paid into the winners’ coins.'
						: 'Prizes pending: the team pays them out soon.'}
				</p>
			{/if}

			{#if finished && standings.length > 0}
				<section aria-label="Winners">
					<ol class="grid grid-cols-3 items-end gap-3">
						{#each PODIUM as place (place)}
							{@const winner = standings[place - 1]}
							{@const prize = prizeOf(place)}
							<li class="flex flex-col items-center text-center">
								{#if winner}
									<span class="max-w-full truncate text-sm font-bold">{winner.name}</span>
									<span
										class="mt-2 grid w-full place-items-center rounded-lg border font-display text-lg font-bold {PODIUM_HEIGHT[
											place
										]} {MEDAL_TONE[place]}">{ordinal(place)}</span
									>
									{#if prize}
										<span
											class="mt-2 text-xs font-bold {place === 1 ? 'text-brass' : 'text-paper/80'}"
										>
											{prize.coins > 0 ? coins(prize.coins) : ''}
										</span>
										{#if prize.extra}<span class="text-xs text-paper/55">+ {prize.extra}</span>{/if}
									{/if}
								{/if}
							</li>
						{/each}
					</ol>
				</section>
			{/if}

			<a
				class="btn-ghost flex h-11 w-full items-center justify-center rounded-xl"
				href="/{game}/tournaments/{tournament.id}"
			>
				{ranksByPoints(tournament.format) ? 'See every round' : 'See the bracket'}
			</a>

			<section aria-labelledby="standings-title">
				<h3 id="standings-title" class="flex items-baseline justify-between gap-3">
					<span class="font-display text-base font-bold"
						>{finished ? 'Final places' : 'Standings'}</span
					>
					{#if !finished}
						<span class="text-xs text-paper/55">
							{tournament.roundStarted
								? `round ${tournament.round} in play`
								: `after round ${tournament.round - 1}`}
						</span>
					{/if}
				</h3>
				<div class="mt-3">
					{#if loading && standings.length === 0}
						<p class="text-sm text-paper/60" aria-live="polite">Loading the standings…</p>
					{:else if standings.length === 0}
						<p class="text-sm text-paper/60">Standings show once the first tables finish.</p>
					{:else}
						<StandingsList
							{standings}
							{byPoints}
							round={tournament.round}
							{finished}
							myId={me?.playerId ?? null}
						/>
					{/if}
				</div>
			</section>
			{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}
			<p class="text-xs text-paper/45">
				{finished
					? `Ended ${when(tournament.endedAt ?? '')}`
					: `Round ${tournament.round} starts ${when(tournament.roundStartsAt)}`}
			</p>
		</div>

		<div class="shrink-0 border-t border-paper/10 p-4 sm:px-6">
			<button class="btn-ghost h-12 w-full rounded-xl text-base" onclick={() => (open = false)}
				>Close</button
			>
		</div>
	{/if}
	<!-- The dialog's brass edge, drawn over the felt so the felt doesn't hide it. -->
	<div
		class="frame pointer-events-none absolute inset-0 rounded-[inherit]"
		aria-hidden="true"
	></div>
</dialog>

<style>
	.frame {
		box-shadow: inset 0 0 0 1.5px var(--color-brass);
	}
</style>
