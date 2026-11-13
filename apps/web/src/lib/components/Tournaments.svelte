<script lang="ts">
	import { ask } from '#lib/confirm.svelte.ts';
	import {
		fetchTournaments,
		joinTournament,
		leaveTournament,
		type Tournament,
		type TournamentTable
	} from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { enterTable } from '#lib/tables.ts';
	import { gameBySlug } from '#lib/games/catalog.ts';
	import { FORMATS } from '#lib/tournament-formats.ts';
	import { when } from '#lib/when.ts';
	import { prefersReducedMotion } from 'svelte/motion';
	import PrizeFee from './PrizeFee.svelte';
	import SignUpBar from './SignUpBar.svelte';
	import TournamentDialog from './TournamentDialog.svelte';
	import TournamentFelt from './TournamentFelt.svelte';

	/**
	 * A game's tournaments as a row of cards that scrolls sideways: the player's own table first, then the ones open
	 * for sign-up. `count` reports how many.
	 */
	let { game, count = $bindable(0) }: { game: string; count?: number } = $props();

	/** The game's own card back, shown on the felt at the top of each card. */
	const back = $derived(gameBySlug(game)?.back ?? '');

	let tables = $state<TournamentTable[]>([]);
	let open = $state<Tournament[]>([]);
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
		void tables.length;
		void open.length;
		updateArrows();
	});

	async function load() {
		try {
			const result = await fetchTournaments(game);
			open = result.tournaments;
			tables = result.tables;
		} catch {
			// Tournaments are extra: the rest of the page works without them.
		}
	}

	$effect(() => {
		count = tables.length + open.length;
	});

	/** `dot`: the colour of the dot beside the label. The chip itself is always dark, so it reads on any felt. */
	type Status = { label: string; dot: string };

	const IN_PLAY: Status = { label: 'In play', dot: 'bg-paper' };
	const SEATED: Status = { label: 'Seated', dot: 'bg-brass' };
	const SIGN_UP_OPEN: Status = { label: 'Sign-up open', dot: 'bg-go' };
	const STARTING_SOON: Status = { label: 'Starting soon', dot: 'bg-brass' };
	const FULL: Status = { label: 'Sign-up closed', dot: 'bg-ember' };

	/** A tournament you sit at: its match has begun, or your seat is waiting for the start. */
	const tableStatus = (table: TournamentTable): Status => (table.started ? IN_PLAY : SEATED);

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
	async function withdraw(table: TournamentTable) {
		const { id, name } = table.tournament;
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

{#if tables.length === 0 && open.length === 0}
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
			{#each tables as t (t.code)}
				{@const status = tableStatus(t)}
				<li class="tournament border-[1.5px] border-brass">
					<TournamentFelt
						label={status.label}
						dot={status.dot}
						startsAt={t.tournament.startsAt}
						{back}
					/>
					<div class="flex flex-1 flex-col p-4 pt-3">
						<h3 class="font-display text-lg font-bold text-paper">{t.tournament.name}</h3>
						<p class="mt-0.5 text-xs text-paper/55">
							You’re in. Your table is <span class="font-semibold text-brass">{t.code}</span>
						</p>
						<div class="mt-auto grid gap-2 pt-4 {t.started ? '' : 'grid-cols-2'}">
							{#if !t.started}
								<button
									class="btn-ghost h-11 rounded-xl"
									onclick={() => withdraw(t)}
									disabled={busy === t.tournament.id}
									aria-label="Withdraw from {t.tournament.name}"
								>
									{busy === t.tournament.id ? 'Saving…' : 'Withdraw'}
								</button>
							{/if}
							<button
								class="btn-brass h-11 rounded-xl"
								onclick={() => (error = enterTable(game, t.code))}>Go to table</button
							>
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
