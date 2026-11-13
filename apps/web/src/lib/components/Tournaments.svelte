<script lang="ts">
	import { ask } from '#lib/confirm.svelte.ts';
	import {
		fetchTournaments,
		joinTournament,
		leaveTournament,
		type LiveTournament,
		type Tournament
	} from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { enterTable } from '#lib/tables.ts';
	import { gameBySlug } from '#lib/games/catalog.ts';
	import {
		coins,
		FORMATS,
		ordinal,
		ranFor,
		ranksByPoints,
		startsIn
	} from '#lib/tournament-formats.ts';
	import { when } from '#lib/when.ts';
	import { prefersReducedMotion } from 'svelte/motion';
	import PrizeFee from './PrizeFee.svelte';
	import SignUpBar from './SignUpBar.svelte';
	import TournamentDialog from './TournamentDialog.svelte';
	import TournamentFelt from './TournamentFelt.svelte';
	import TournamentLiveDialog from './TournamentLiveDialog.svelte';

	/**
	 * A game's tournaments as a row of cards that scrolls sideways: the ones playing (with the player's place and
	 * table), the ones open for sign-up, then the ones that finished in the last day. `count` reports how many.
	 */
	let { game, count = $bindable(0) }: { game: string; count?: number } = $props();

	/** The game's own card back, shown on the felt at the top of each card. */
	const back = $derived(gameBySlug(game)?.back ?? '');

	let live = $state<LiveTournament[]>([]);
	let open = $state<Tournament[]>([]);
	const running = $derived(live.filter((tournament) => !tournament.endedAt));
	const finished = $derived(live.filter((tournament) => tournament.endedAt));

	/** The countdowns on running cards tick while any is waiting for its round. */
	const TICK_MS = 15_000;
	let now = $state(Date.now());

	$effect(() => {
		if (running.length === 0) {
			return;
		}

		const timer = setInterval(() => {
			now = Date.now();
		}, TICK_MS);

		return () => clearInterval(timer);
	});
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);

	let scroller = $state<HTMLUListElement>();
	let canGoBack = $state(false);
	let canGoForward = $state(false);

	/** Slack for rounding, so a row scrolled to its end doesn't still offer an arrow. */
	const EDGE_PX = 4;
	/** One arrow press moves this share of the visible row, so the last card stays in view as a cue. */
	const PAGE_SHARE = 0.9;

	function updateArrows() {
		if (!scroller) {
			return;
		}

		const { scrollLeft, clientWidth, scrollWidth } = scroller;
		canGoBack = scrollLeft > EDGE_PX;
		canGoForward = scrollLeft + clientWidth < scrollWidth - EDGE_PX;
	}

	function page(direction: 1 | -1) {
		if (!scroller) {
			return;
		}

		const behavior = prefersReducedMotion.current ? 'auto' : 'smooth';
		scroller.scrollBy({ left: direction * scroller.clientWidth * PAGE_SHARE, behavior });
	}

	// The cards change when the lists reload; the arrows follow.
	$effect(() => {
		void live.length;
		void open.length;
		updateArrows();
	});

	async function load() {
		try {
			const result = await fetchTournaments(game);
			open = result.tournaments;
			live = result.live;
			now = Date.now();
		} catch {
			// Tournaments are extra: the rest of the page works without them.
		}
	}

	$effect(() => {
		count = live.length + open.length;
	});

	/** `dot`: the colour of the dot beside the label. The chip itself is always dark, so it reads on any felt. */
	type Status = { label: string; dot: string };

	const SIGN_UP_OPEN: Status = { label: 'Sign-up open', dot: 'bg-go' };
	const STARTING_SOON: Status = { label: 'Starting soon', dot: 'bg-brass' };
	const FULL: Status = { label: 'Sign-up closed', dot: 'bg-ember' };

	const isFull = (tournament: Tournament) =>
		tournament.maxPlayers !== null && tournament.registered >= tournament.maxPlayers;

	/** A tournament open for sign-up until it fills or sign-up closes; after that it is about to start. */
	function openStatus(tournament: Tournament): Status {
		const closesAt = Date.parse(tournament.registrationClosesAt);
		if (Date.now() >= closesAt) {
			return STARTING_SOON;
		}

		if (isFull(tournament)) {
			return FULL;
		}

		return SIGN_UP_OPEN;
	}

	/**
	 * The card's main button: Leave for a player who is in; Join in brass while sign-up is open, else a quiet outline
	 * that reads as off.
	 */
	function actionOf(tournament: Tournament, status: Status) {
		const saving = busy === tournament.id;

		if (tournament.joined) {
			return { label: saving ? 'Saving…' : 'Leave', style: 'btn-ghost', disabled: saving };
		}

		if (status === SIGN_UP_OPEN) {
			return { label: saving ? 'Saving…' : 'Join', style: 'btn-brass', disabled: saving };
		}

		return {
			label: 'Join',
			style: 'btn border border-paper/25 bg-black/20 text-paper',
			disabled: true
		};
	}

	/** The tournament whose Detail dialog is open. */
	let detailId = $state<string | null>(null);
	let detailOpen = $state(false);
	const detail = $derived(open.find((tournament) => tournament.id === detailId) ?? null);
	const detailStatus = $derived(detail ? openStatus(detail) : SIGN_UP_OPEN);

	function showDetail(tournament: Tournament) {
		detailId = tournament.id;
		detailOpen = true;
	}

	// Reload once the player has a name: a brand-new visitor has no account to sign up with yet.
	$effect(() => {
		if (player.ready && player.name) void load();
	});

	/** Gives up a seat already handed out. The platform keeps the player out of this tournament from then on. */
	async function withdraw(tournament: LiveTournament) {
		const { id, name } = tournament;
		const sure = await ask({
			title: `Withdraw from ${name}?`,
			body: 'Your seat is given up and you can’t come back to this tournament.',
			action: 'Withdraw'
		});
		if (!sure) {
			return;
		}

		busy = id;
		error = null;

		try {
			await leaveTournament(id);
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		} finally {
			busy = null;
		}
	}

	/** "Round 2 of 3" for Arena and Swiss; a knockout plays until one is left, so just "Round 2". */
	function roundLabel(tournament: LiveTournament): string {
		if (!ranksByPoints(tournament.format)) {
			return `Round ${tournament.round}`;
		}

		return `Round ${tournament.round} of ${tournament.rounds ?? 3}`;
	}

	/** The felt's line: when the round starts, or that it is being played. */
	function roundLine(tournament: LiveTournament): string {
		if (tournament.roundStarted) {
			return `Round ${tournament.round} in play`;
		}

		return startsIn(tournament.roundStartsAt, now);
	}

	/** The brass line under the name: where the player stands. */
	function myLine(tournament: LiveTournament): string | null {
		const me = tournament.me;
		if (!me) {
			return tournament.table ? 'You’re in' : null;
		}

		if (ranksByPoints(tournament.format)) {
			return `You’re ${ordinal(me.place)} with ${me.points} points`;
		}

		if (tournament.table) {
			return `You’re in round ${tournament.round}`;
		}

		return `You’re out · ${ordinal(me.place)}`;
	}

	/** A card row's right side: points, or how far a knockout player got. */
	function rowNote(tournament: LiveTournament, standing: LiveTournament['top'][number]): string {
		if (ranksByPoints(tournament.format)) {
			return `${standing.points} pts`;
		}

		return standing.lastRound >= tournament.round ? 'in' : `out in round ${standing.lastRound}`;
	}

	const prizeFor = (tournament: LiveTournament, place: number) =>
		tournament.prizes.find((prize) => prize.place === place);

	/** Whose live Detail is open. */
	let liveId = $state<string | null>(null);
	let liveOpen = $state(false);
	const liveDetail = $derived(live.find((tournament) => tournament.id === liveId) ?? null);

	function showLive(tournament: LiveTournament) {
		liveId = tournament.id;
		liveOpen = true;
	}

	async function toggle(tournament: Tournament) {
		busy = tournament.id;
		error = null;

		try {
			if (tournament.joined) {
				await leaveTournament(tournament.id);
			} else {
				await joinTournament(tournament.id);
			}

			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		} finally {
			busy = null;
		}
	}
</script>

{#if live.length === 0 && open.length === 0}
	<p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
		No tournaments open for sign-up right now.
	</p>
{:else}
	<div class="relative">
		<!-- Snap scrolling row; the next card peeks in at the edge, so it reads as more to swipe. Every card has a
			 button, so tabbing through them scrolls the row with the keyboard. -->
		<ul
			bind:this={scroller}
			onscroll={updateArrows}
			class="carousel -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
		>
			{#each running as t (t.id)}
				{@const line = myLine(t)}
				<li class="tournament {t.table ? 'border-[1.5px] border-brass' : 'border border-paper/10'}">
					<TournamentFelt
						label={roundLabel(t)}
						dot="bg-paper"
						startsAt={t.roundStartsAt}
						headline={roundLine(t)}
						{back}
					/>
					<div class="flex flex-1 flex-col p-4 pt-3">
						<h3 class="font-display text-lg font-bold text-paper">{t.name}</h3>
						<p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
							{#if t.format}
								<span class="rounded-md border border-brass/55 px-1.5 py-0.5 font-bold text-brass"
									>{FORMATS[t.format].label}</span
								>
							{/if}
							{#if line}
								<span class="font-bold text-brass">{line}</span>
							{:else}
								<span class="text-paper/55">{t.players} players</span>
							{/if}
						</p>
						{#if t.top.length > 0}
							<ol class="mt-3 space-y-1 text-sm" aria-label="Top of the standings">
								{#each t.top as standing (standing.playerId)}
									{@const mine = standing.playerId === t.me?.playerId}
									<li
										class="flex items-center gap-3 rounded-md px-2 py-1 {mine ? 'bg-brass/12' : ''}"
									>
										<span class="w-4 font-extrabold text-brass tabular-nums">{standing.place}</span>
										<span class="min-w-0 flex-1 truncate {mine ? 'font-bold' : ''}"
											>{standing.name}{mine ? ' (you)' : ''}</span
										>
										<span class="text-xs text-paper/70 tabular-nums">{rowNote(t, standing)}</span>
									</li>
								{/each}
							</ol>
						{:else}
							<p class="mt-3 text-xs text-paper/55">Standings show once the first tables finish.</p>
						{/if}
						<div
							class="mt-auto grid gap-2.5 pt-4 {t.table && !t.table.closed ? 'grid-cols-2' : ''}"
						>
							<button
								class="btn-ghost h-11 rounded-xl"
								onclick={() => showLive(t)}
								aria-label="Standings of {t.name}">Standings</button
							>
							{#if t.table && !t.table.closed}
								<button
									class="btn-brass h-11 rounded-xl"
									onclick={() => (error = enterTable(game, t.table!.code))}>Go to table</button
								>
							{/if}
						</div>
					</div>
				</li>
			{/each}
			{#each open as t (t.id)}
				{@const status = openStatus(t)}
				{@const action = actionOf(t, status)}
				<li
					class="tournament {t.joined ? 'border-[1.5px] border-brass' : 'border border-paper/10'}"
				>
					<TournamentFelt label={status.label} dot={status.dot} startsAt={t.startsAt} {back} />
					<div class="flex flex-1 flex-col p-4 pt-3">
						<h3 class="font-display text-lg font-bold text-paper">{t.name}</h3>
						<p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper/55">
							{#if t.format}
								<span class="rounded-md border border-brass/55 px-1.5 py-0.5 font-bold text-brass"
									>{FORMATS[t.format].label}</span
								>
							{/if}
							<span
								>{t.playersPerRoom} per table · Sign-up closes {when(t.registrationClosesAt)}</span
							>
						</p>
						<div class="mt-3">
							<PrizeFee prizes={t.prizes} fee={t.fee} />
						</div>
						<div class="mt-auto pt-4">
							<SignUpBar
								registered={t.registered}
								minPlayers={t.minPlayers}
								maxPlayers={t.maxPlayers}
								joined={t.joined}
								full={status === FULL}
							/>
						</div>
						<div class="mt-4 grid grid-cols-2 gap-2.5">
							<button
								class="btn-ghost h-11 rounded-xl"
								onclick={() => showDetail(t)}
								aria-label="Details of {t.name}">Detail</button
							>
							<button
								class="{action.style} h-11 rounded-xl"
								onclick={() => toggle(t)}
								disabled={action.disabled}
								aria-label="{t.joined ? 'Leave' : 'Join'} {t.name}"
							>
								{action.label}
							</button>
						</div>
					</div>
				</li>
			{/each}
			{#each finished as t (t.id)}
				<li class="tournament border border-paper/10">
					<TournamentFelt
						label="Finished"
						dot="bg-brass"
						startsAt={t.endedAt ?? t.roundStartsAt}
						headline="Ran {ranFor(t.startsAt, t.endedAt ?? t.startsAt)}"
						{back}
					/>
					<div class="flex flex-1 flex-col p-4 pt-3">
						<h3 class="font-display text-lg font-bold text-paper">{t.name}</h3>
						<p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper/55">
							{#if t.format}
								<span class="rounded-md border border-brass/55 px-1.5 py-0.5 font-bold text-brass"
									>{FORMATS[t.format].label}</span
								>
							{/if}
							{t.players} players · {t.round}
							{t.round === 1 ? 'round' : 'rounds'}
						</p>
						<ol class="mt-3 space-y-2 text-sm" aria-label="Winners">
							{#each t.top as standing (standing.playerId)}
								{@const prize = prizeFor(t, standing.place)}
								<li class="flex items-center gap-3">
									<span
										class="grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold {standing.place ===
										1
											? 'bg-brass text-ink'
											: 'bg-paper/15 text-paper'}">{standing.place}</span
									>
									<span class="min-w-0 flex-1 truncate font-semibold">{standing.name}</span>
									{#if prize && prize.coins > 0}
										<span
											class="text-xs font-bold tabular-nums {standing.place === 1
												? 'text-brass'
												: 'text-paper/80'}">{coins(prize.coins)}</span
										>
									{/if}
								</li>
							{/each}
						</ol>
						<div class="mt-auto pt-4">
							<button
								class="btn-ghost h-11 w-full rounded-xl"
								onclick={() => showLive(t)}
								aria-label="Results of {t.name}">Results</button
							>
						</div>
					</div>
				</li>
			{/each}
		</ul>
		{#if canGoBack}
			<button
				class="arrow absolute top-1/2 -left-5 hidden md:grid"
				onclick={() => page(-1)}
				aria-label="Earlier tournaments"
			>
				<svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
					<path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" />
				</svg>
			</button>
		{/if}
		{#if canGoForward}
			<button
				class="arrow absolute top-1/2 -right-5 hidden md:grid"
				onclick={() => page(1)}
				aria-label="More tournaments"
			>
				<svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
					<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" />
				</svg>
			</button>
		{/if}
	</div>
{/if}
{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}

<TournamentLiveDialog
	bind:open={liveOpen}
	tournament={liveDetail}
	{game}
	{back}
	{now}
	onwithdraw={withdraw}
/>

<TournamentDialog
	bind:open={detailOpen}
	tournament={detail}
	status={detailStatus}
	{back}
	full={detailStatus === FULL}
	action={detail
		? actionOf(detail, detailStatus)
		: { label: 'Join', style: 'btn-brass', disabled: true }}
	onaction={() => detail && toggle(detail)}
/>

<style>
	.tournament {
		display: flex;
		width: 85%;
		flex-shrink: 0;
		scroll-snap-align: start;
		flex-direction: column;
		overflow: hidden;
		border-radius: 1rem;
		background: var(--color-panel);
	}
	@media (min-width: 40rem) {
		.tournament {
			width: 20rem;
		}
	}
	.carousel {
		scrollbar-width: thin;
		scrollbar-color: rgb(243 234 214 / 0.2) transparent;
	}
	/* Phones swipe, and the peeking card already says there is more; the bar would only add a stray line. */
	@media (max-width: 47.99rem) {
		.carousel {
			scrollbar-width: none;
		}
	}
	/* Shown from md up through Tailwind's `hidden md:grid`, so no display here. */
	.arrow {
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		translate: 0 -50%;
		border-radius: 9999px;
		border: 1px solid rgb(243 234 214 / 0.15);
		background: var(--color-panel);
		color: var(--color-paper);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.45);
	}
	.arrow:hover {
		border-color: rgb(210 165 76 / 0.6);
	}
</style>
