<script lang="ts">
	import { page } from '$app/state';
	import { fetchTournaments, type LiveTournament } from '#lib/platform.ts';
	import { enterTable } from '#lib/tables.ts';
	import { ordinal, pointsText, ranksByPoints, startsIn } from '#lib/tournament-formats.ts';

	/**
	 * In a tournament table's result popup: what happens to this player next. The next round's table only exists once
	 * every table of this round is done, so it asks the platform every few seconds until it knows, and calls
	 * `onchange` when the answer changes (next table ready, out, tournament over) so the popup can open again.
	 */
	let {
		game,
		tournamentId,
		tournamentName,
		round,
		onchange
	}: {
		game: string;
		tournamentId: string;
		tournamentName: string;
		/** The round this table played. */
		round: number;
		onchange: () => void;
	} = $props();

	const POLL_MS = 5_000;
	const TICK_MS = 1_000;

	let tournament = $state<LiveTournament | null>(null);
	let now = $state(Date.now());
	let error = $state<string | null>(null);

	async function load() {
		try {
			const { live } = await fetchTournaments(game);
			tournament = live.find((entry) => entry.id === tournamentId) ?? null;
		} catch {
			// The next poll tries again; the table's own result is already on screen.
		}
	}

	$effect(() => {
		void load();
		const poll = setInterval(load, POLL_MS);
		const tick = setInterval(() => {
			now = Date.now();
		}, TICK_MS);

		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	const thisCode = $derived(page.params.code ?? '');
	const byPoints = $derived(ranksByPoints(tournament?.format ?? null));

	type Next =
		| { kind: 'loading' }
		| { kind: 'next'; title: string; line: string; code: string }
		| { kind: 'waiting'; title: string }
		| { kind: 'out'; title: string }
		| { kind: 'ended'; title: string };

	/** Where the player stands now, from the tournament's latest round and their place. */
	const next = $derived.by((): Next => {
		if (!tournament) {
			return { kind: 'loading' };
		}

		const me = tournament.me;
		if (tournament.endedAt) {
			return {
				kind: 'ended',
				title: me ? `You finished ${ordinal(me.place)}` : 'The tournament is over'
			};
		}

		const table = tournament.table;
		const moved = tournament.round > round && table && table.code !== thisCode && !table.closed;
		if (moved) {
			const title =
				byPoints && me
					? `${pointsText(me.points)} · ${ordinal(me.place)} overall`
					: `You go on to round ${tournament.round}`;
			const when = tournament.roundStarted
				? 'is in play'
				: startsIn(tournament.roundStartsAt, now).toLowerCase();
			return { kind: 'next', title, line: `Your table ${table.code} ${when}`, code: table.code };
		}

		if (tournament.round > round && !byPoints) {
			const place = me ? ` · ${ordinal(me.place)} of ${tournament.players}` : '';
			return { kind: 'out', title: `You’re out${place}` };
		}

		return {
			kind: 'waiting',
			title: byPoints ? 'Round done' : 'Waiting to see who goes on'
		};
	});

	// A decided answer (or a new table) is worth showing again, even after the player closed the popup.
	let shownKey = '';
	$effect(() => {
		if (next.kind === 'loading' || next.kind === 'waiting') {
			return;
		}

		const key = next.kind === 'next' ? next.code : next.kind;
		if (key === shownKey) {
			return;
		}

		shownKey = key;
		onchange();
	});
</script>

<div aria-live="polite">
	<p class="text-sm font-semibold text-brass">{tournamentName} · round {round} done</p>
	{#if next.kind === 'loading'}
		<p class="mt-1.5 text-sm text-paper/75">Checking the next round…</p>
	{:else}
		<p class="mt-1.5 font-display text-xl font-extrabold text-paper">{next.title}</p>
		<p class="mt-1 text-sm text-paper/75">
			{#if next.kind === 'next'}
				{next.line}
			{:else if next.kind === 'waiting'}
				Waiting for the other tables to finish…
			{:else if next.kind === 'out'}
				Final places when the tournament ends.
			{:else}
				See the winners in the lobby.
			{/if}
		</p>
	{/if}
	{#if error}<p class="mt-2 text-sm text-ember" role="alert">{error}</p>{/if}
	{#if next.kind === 'next'}
		<button class="btn-brass mt-4 w-full" onclick={() => (error = enterTable(game, next.code))}
			>Go to table</button
		>
	{:else}
		<a class="btn-ghost mt-4 w-full" href="/{game}">Back to the lobby</a>
	{/if}
</div>
