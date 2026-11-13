<script lang="ts">
	import type { RoundCheck } from 'server/games/shared/fairness';
	import type { Round } from '#lib/rounds.ts';
	import { when } from '#lib/when.ts';
	import DeckChips from './DeckChips.svelte';
	import RoundMoves from './RoundMoves.svelte';
	import RoundResult from './RoundResult.svelte';
	import SeedField from './SeedField.svelte';

	/**
	 * One closed round, as a dialog over the round list, in two tabs: the round itself (its result, the hands
	 * dealt and every move) and its fairness (its revealed seed, the hash shown before it, and every shuffle with
	 * its client seed and deck). `check` is this browser's own check of it.
	 */
	let {
		game,
		round,
		check,
		nameOf,
		onback,
		onclose
	}: {
		game: string;
		round: Round | null;
		check: RoundCheck | null;
		nameOf: (seat: number) => string | null;
		onback: () => void;
		onclose: () => void;
	} = $props();

	const TABS = [
		{ id: 'round', label: 'Round' },
		{ id: 'fairness', label: 'Fairness' }
	] as const;
	type TabId = (typeof TABS)[number]['id'];

	let dialog = $state<HTMLDialogElement>();
	let tab = $state<TabId>('round');
	let tabButtons = $state<HTMLButtonElement[]>([]);
	/** Reshuffle decks are long and rarely read: each opens on request. */
	let shownDecks = $state<number[]>([]);

	$effect(() => {
		if (round && !dialog?.open) {
			tab = 'round';
			shownDecks = [0];
			dialog?.showModal();
		}

		if (!round && dialog?.open) {
			dialog.close();
		}
	});

	/** Arrow keys, Home and End move between tabs, as a tab list does. */
	function onTabKey(event: KeyboardEvent, index: number) {
		const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
		let next = index;

		if (Object.hasOwn(steps, event.key)) {
			next = (index + steps[event.key]! + TABS.length) % TABS.length;
		} else if (event.key === 'Home') {
			next = 0;
		} else if (event.key === 'End') {
			next = TABS.length - 1;
		} else {
			return;
		}

		event.preventDefault();
		tab = TABS[next]!.id;
		tabButtons[next]?.focus();
	}

	const okOf = (nonce: number) => check?.shuffles.find((shuffle) => shuffle.nonce === nonce)?.ok;
	const shuffleName = (nonce: number) => (nonce === 0 ? 'Deal' : `Reshuffle ${nonce}`);
	const time = (iso: string) =>
		new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
			new Date(iso)
		);
	const moveCount = $derived(
		round?.events.filter((event) => event.seat !== undefined && event.type !== 'away').length ?? 0
	);
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="round-title"
	onclose={onback}
	class="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-paper/15 bg-panel p-5 text-sm text-paper/75 backdrop:bg-transparent sm:p-6"
>
	{#if round}
		<div class="flex items-start justify-between gap-4">
			<div>
				<button
					class="text-xs text-brass hover:underline focus-visible:underline"
					onclick={() => dialog?.close()}
				>
					‹ Rounds
				</button>
				<h2 id="round-title" class="mt-1 font-display text-2xl font-bold text-paper">
					Round {round.round}
				</h2>
				<p class="mt-1 text-xs text-paper/55">
					<time datetime={round.startedAt} title={when(round.startedAt)}
						>{time(round.startedAt)}</time
					>
					to {time(round.endedAt)}, {moveCount}
					{moveCount === 1 ? 'move' : 'moves'}
				</p>
			</div>
			<button class="btn-ghost size-10 shrink-0 p-0" onclick={onclose} aria-label="Close">
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

		<div
			role="tablist"
			aria-label="Round {round.round}"
			class="mt-4 flex gap-1 border-b border-paper/10"
		>
			{#each TABS as item, index (item.id)}
				<button
					bind:this={tabButtons[index]}
					id="round-tab-{item.id}"
					role="tab"
					aria-selected={tab === item.id}
					aria-controls="round-panel-{item.id}"
					tabindex={tab === item.id ? 0 : -1}
					class="-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors focus-visible:text-paper {tab ===
					item.id
						? 'border-brass text-paper'
						: 'border-transparent text-paper/55 hover:text-paper/80'}"
					onclick={() => (tab = item.id)}
					onkeydown={(event) => onTabKey(event, index)}
				>
					{item.label}
					{#if item.id === 'fairness' && check}
						<span class="ml-1 text-xs {check.ok ? 'text-brass' : 'text-ember'}" aria-hidden="true">
							{check.ok ? '✓' : '✕'}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<div
			id="round-panel-round"
			role="tabpanel"
			aria-labelledby="round-tab-round"
			hidden={tab !== 'round'}
			class="mt-5"
		>
			<RoundResult {game} result={round.result} events={round.events} {nameOf} />
			<div class="mt-6">
				<RoundMoves {game} events={round.events} {nameOf} />
			</div>
		</div>

		<div
			id="round-panel-fairness"
			role="tabpanel"
			aria-labelledby="round-tab-fairness"
			hidden={tab !== 'fairness'}
			class="mt-5 space-y-3"
		>
			{#if check}
				<p
					class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold {check.ok
						? 'border-brass/50 text-brass'
						: 'border-ember/60 text-ember'}"
					role="status"
				>
					{check.ok
						? `✓ Verified: ${round.shuffles.length === 1 ? 'the shuffle matches' : 'every shuffle matches'} the seed`
						: '✕ Does not match the seed'}
				</p>
			{/if}

			<SeedField id="round-seed" label="Server seed" value={round.serverSeed} />
			<SeedField
				id="round-seed-hash"
				label="Server seed (hashed), shown before the round"
				value={round.serverSeedHash}
			/>

			{#each round.shuffles as shuffle (shuffle.nonce)}
				{@const ok = okOf(shuffle.nonce)}
				<section class="rounded-lg border border-paper/10 p-4">
					<div class="flex items-center justify-between">
						<h4 class="font-semibold text-paper">{shuffleName(shuffle.nonce)}</h4>
						{#if ok === true}
							<span class="text-xs text-brass">✓ matches</span>
						{:else if ok === false}
							<span class="text-xs text-ember">✕ does not match</span>
						{/if}
					</div>
					<div class="mt-2">
						<SeedField
							id="client-seed-{shuffle.nonce}"
							label="Client seed"
							value={shuffle.clientSeed}
						/>
					</div>
					{#if shownDecks.includes(shuffle.nonce)}
						<p class="mt-3 mb-2 label">Deck, top first ({shuffle.deck.length} cards)</p>
						<DeckChips {game} deck={shuffle.deck} />
					{:else}
						<button
							class="link-btn mt-1 px-0 text-xs"
							onclick={() => (shownDecks = [...shownDecks, shuffle.nonce])}
						>
							Show deck ({shuffle.deck.length})
						</button>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</dialog>
