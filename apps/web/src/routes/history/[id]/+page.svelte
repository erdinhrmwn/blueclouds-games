<script lang="ts">
	import type { RoundCheck } from 'server/games/shared/fairness';
	import RoundDetail from '#lib/components/RoundDetail.svelte';
	import { gameBySlug } from '#lib/games/catalog.ts';
	import { type Round, roundSummary, verifyRound } from '#lib/rounds.ts';
	import type { PageProps } from './$types';

	/**
	 * A match's closed rounds, running or finished. Each round's seed is revealed when it closes, so this browser
	 * checks every round as the page opens; a round opens in a dialog (docs/architecture/fairness.md).
	 */
	let { data }: PageProps = $props();

	const match = $derived(data.match);
	const gameName = $derived(gameBySlug(match.game)?.name ?? match.game);

	const nameOf = (seat: number) =>
		match.players.find((player) => player.seat === seat)?.name ?? null;

	let checks = $state<Map<number, RoundCheck>>(new Map());
	let selected = $state<Round | null>(null);

	$effect(() => {
		const matchId = match.id;
		const rounds = data.rounds;

		void Promise.all(rounds.map((round) => verifyRound(matchId, round))).then((results) => {
			checks = new Map(results.map((check) => [check.round, check]));
		});
	});

	const allChecked = $derived(checks.size === data.rounds.length && data.rounds.length > 0);
	const allOk = $derived(allChecked && [...checks.values()].every((check) => check.ok));
</script>

<svelte:head><title>{gameName} match · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-2xl pt-10 md:pt-16">
	<p class="text-sm"><a class="text-brass hover:underline" href="/history">Match history</a></p>
	<h1 class="mt-2 font-display text-4xl leading-tight font-black">{gameName} match</h1>
	<p class="mt-2 font-mono text-xs break-all text-paper/55">{match.id}</p>
	<p class="mt-3 text-sm text-paper/75">
		{match.finished ? 'Finished.' : 'Still being played: rounds show up here as they end.'}
		{#if allChecked}
			<span class={allOk ? 'text-brass' : 'text-ember'}>
				{allOk
					? 'Every round checks out against its own revealed seed.'
					: 'Some rounds do not match their seed.'}
			</span>
		{/if}
	</p>

	{#if data.rounds.length === 0}
		<p class="mt-8 rounded-xl border border-paper/15 bg-panel p-6 text-sm text-paper/75">
			{match.finished
				? 'This match was played before round history was kept.'
				: 'No round has ended yet.'}
		</p>
	{:else}
		<ul class="mt-8 divide-y divide-paper/10 rounded-xl border border-paper/15 bg-panel">
			{#each data.rounds as round (round.round)}
				{@const check = checks.get(round.round)}
				<li>
					<button
						class="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
						onclick={() => (selected = round)}
						aria-haspopup="dialog"
					>
						<span class="min-w-0 flex-1">
							<span class="block font-semibold text-paper">Round {round.round}</span>
							<span class="block text-xs text-paper/65"
								>{roundSummary(match.game, round.result, nameOf)}</span
							>
						</span>
						{#if check}
							<span class="shrink-0 text-xs font-medium {check.ok ? 'text-brass' : 'text-ember'}">
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
</section>

<RoundDetail
	game={match.game}
	round={selected}
	check={selected ? (checks.get(selected.round) ?? null) : null}
	{nameOf}
	onback={() => (selected = null)}
	onclose={() => (selected = null)}
/>
