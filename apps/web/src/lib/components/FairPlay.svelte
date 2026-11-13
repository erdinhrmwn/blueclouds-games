<script lang="ts">
	import type { RoundCheck } from 'server/games/shared/fairness';
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';
	import { type MatchRounds, type Round, roundSummary, verifyRound } from '#lib/rounds.ts';
	import RoundDetail from './RoundDetail.svelte';
	import SeedField from './SeedField.svelte';

	/**
	 * Provably fair rounds: a button in the table's header opens the rounds of the match being played. The round
	 * in play shows its server seed hash and client seed; each closed round, with its seed revealed, is checked in
	 * this browser and opens in a dialog of its own (docs/architecture/fairness.md).
	 */
	let { room, game }: { room: RoomConnection<BaseView, unknown>; game: string } = $props();

	let dialog = $state<HTMLDialogElement>();
	let rounds = $state<Round[] | null>(null);
	let checks = $state<Map<number, RoundCheck>>(new Map());
	let roundsError = $state<string | null>(null);
	let selected = $state<Round | null>(null);

	const fairness = $derived(room.view?.fairness ?? null);
	/** The match whose rounds the dialog lists: the one being played, else the last one played here. */
	const listedMatchId = $derived(fairness?.matchId ?? fairness?.lastMatchId ?? null);
	const short = (hash: string) => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

	const nameOf = (seat: number) => room.view?.players.find((p) => p.seat === seat)?.name ?? null;

	/** Opens the dialog, then reads the match's closed rounds and checks each one. */
	async function open() {
		dialog?.showModal();
		roundsError = null;

		const matchId = listedMatchId;
		if (!matchId) {
			rounds = [];
			return;
		}

		try {
			const res = await fetch(`/api/matches/${matchId}/rounds`);
			if (res.status === 404) {
				rounds = [];
				return;
			}

			if (!res.ok) {
				throw new Error(`status ${res.status}`);
			}

			const body = (await res.json()) as MatchRounds;
			rounds = [...body.rounds].reverse();
			await checkAll(matchId, body.rounds);
		} catch {
			roundsError = 'Could not load the rounds.';
		}
	}

	async function checkAll(matchId: string, closed: Round[]) {
		const results = await Promise.all(closed.map((round) => verifyRound(matchId, round)));
		checks = new Map(results.map((check) => [check.round, check]));
	}

	function closeAll() {
		selected = null;
		dialog?.close();
	}
</script>

{#if fairness}
	<button
		class="btn-ghost size-10 shrink-0 p-0 sm:size-11"
		onclick={open}
		aria-haspopup="dialog"
		aria-label="Rounds and fair play"
		title="Rounds and fair play"
	>
		<!-- A shield with a tick: the deal can be checked. -->
		<svg
			viewBox="0 0 20 20"
			class="size-5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M10 2.5 4 5v4.5c0 3.8 2.6 6.9 6 8 3.4-1.1 6-4.2 6-8V5l-6-2.5Z" />
			<path d="m7.25 10 2 2 3.5-3.75" />
		</svg>
	</button>

	<dialog
		bind:this={dialog}
		aria-labelledby="rounds-title"
		class="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-paper/15 bg-panel p-5 text-sm text-paper/75 backdrop:bg-black/70 sm:p-6"
	>
		<div class="flex items-start justify-between gap-4">
			<div>
				<h2 id="rounds-title" class="font-display text-2xl font-bold text-paper">Rounds</h2>
				<p class="mt-1 text-xs text-paper/55">
					Each round is shuffled with its own server seed, locked in before the deal and revealed
					when the round ends.
				</p>
			</div>
			<button class="btn-ghost size-10 shrink-0 p-0" onclick={closeAll} aria-label="Close">
				<svg
					viewBox="0 0 20 20"
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="m5 5 10 10M15 5 5 15" />
				</svg>
			</button>
		</div>

		<section
			class="mt-5 rounded-lg border border-brass/40 bg-brass/[0.06] p-4"
			aria-labelledby="round-now"
		>
			<div class="flex items-center justify-between gap-3">
				<h3 id="round-now" class="font-semibold text-paper">Round {fairness.round}</h3>
				<span class="inline-flex items-center gap-1.5 text-xs font-medium text-brass">
					<span class="size-1.5 rounded-full bg-brass" aria-hidden="true"></span>
					{fairness.matchId ? 'Now playing' : 'Locked in for the next match'}
				</span>
			</div>
			<div class="mt-3 space-y-3">
				<SeedField id="server-seed" label="Server seed (hashed)" value={fairness.serverSeedHash} />
				{#if fairness.clientSeed}
					<SeedField id="client-seed" label="Client seed" value={fairness.clientSeed} />
				{/if}
			</div>
			{#if fairness.nextServerSeedHash}
				<p class="mt-3 text-xs text-paper/55">
					Round {fairness.round + 1} is already locked in:
					<span class="font-mono text-paper/75" title={fairness.nextServerSeedHash}>
						{short(fairness.nextServerSeedHash)}
					</span>
				</p>
			{/if}
		</section>

		{#if listedMatchId}
			<div class="mt-6 flex items-baseline justify-between gap-3">
				<h3 class="label">{fairness.matchId ? 'Earlier rounds' : 'Last match'}</h3>
				<a
					href="/history/{listedMatchId}"
					class="text-xs text-brass hover:underline focus-visible:underline"
				>
					Match history
				</a>
			</div>
			{#if roundsError}
				<p class="mt-2 text-xs text-ember" role="alert">{roundsError}</p>
			{:else if rounds === null}
				<p class="mt-2 text-xs text-paper/55">Loading…</p>
			{:else if rounds.length === 0}
				<p class="mt-2 text-xs text-paper/55">None yet: this is the first round.</p>
			{:else}
				<ul class="mt-2 divide-y divide-paper/10 rounded-lg border border-paper/10">
					{#each rounds as round (round.round)}
						{@const check = checks.get(round.round)}
						<li>
							<button
								class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
								onclick={() => (selected = round)}
								aria-haspopup="dialog"
							>
								<span class="min-w-0 flex-1">
									<span class="block font-semibold text-paper">Round {round.round}</span>
									<span class="block text-xs text-paper/65">
										{roundSummary(game, round.result, nameOf)}
									</span>
								</span>
								{#if check}
									<span
										class="shrink-0 text-xs font-medium {check.ok ? 'text-brass' : 'text-ember'}"
									>
										{check.ok ? '✓ Verified' : '✕ Mismatch'}
									</span>
								{/if}
								<svg
									viewBox="0 0 20 20"
									class="size-4 shrink-0 text-paper/40"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg
								>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</dialog>

	<RoundDetail
		{game}
		round={selected}
		check={selected ? (checks.get(selected.round) ?? null) : null}
		{nameOf}
		onback={() => (selected = null)}
		onclose={closeAll}
	/>
{/if}
