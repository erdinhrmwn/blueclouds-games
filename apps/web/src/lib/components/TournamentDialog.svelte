<script lang="ts">
	import type { Tournament } from '#lib/platform.ts';
	import { avatarTone, coins, FORMATS, startsIn } from '#lib/tournament-formats.ts';
	import { when } from '#lib/when.ts';
	import PrizeFee from './PrizeFee.svelte';
	import SignUpBar from './SignUpBar.svelte';
	import TournamentFelt from './TournamentFelt.svelte';

	/**
	 * A tournament's Detail: a countdown on the game's felt, what it is, the prize podium, its schedule, how its
	 * format plays, who's in, and Join or Leave.
	 */
	let {
		open = $bindable(false),
		tournament,
		status,
		back,
		full,
		action,
		onaction
	}: {
		open?: boolean;
		tournament: Tournament | null;
		status: { label: string; dot: string };
		back: string;
		full: boolean;
		/** Join or Leave, as the card shows it. */
		action: { label: string; style: string; disabled: boolean };
		onaction: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (open && !dialog.open) {
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	/** The countdown ticks while the dialog is open; a minute is its smallest unit. */
	const TICK_MS = 15_000;
	let now = $state(Date.now());

	$effect(() => {
		if (!open) {
			return;
		}

		now = Date.now();
		const timer = setInterval(() => {
			now = Date.now();
		}, TICK_MS);

		return () => clearInterval(timer);
	});

	const format = $derived(tournament?.format ? FORMATS[tournament.format] : null);
	/** Arena and Swiss play this many rounds when the admin set none (the platform's default). */
	const DEFAULT_ROUNDS = 3;
	const steps = $derived(
		tournament && format
			? format.steps(tournament.playersPerRoom, tournament.rounds ?? DEFAULT_ROUNDS)
			: []
	);

	type Moment = { label: string; at: string };
	type Step = Moment & { state: 'done' | 'next' | 'later' };

	/** Sign-up opening, closing, tables handed out, first round: what's done, what's next, what follows. */
	const schedule = $derived.by((): Step[] => {
		if (!tournament) {
			return [];
		}

		const moments: Moment[] = [
			{ label: 'Sign-up opens', at: tournament.registrationOpensAt },
			{ label: 'Sign-up closes', at: tournament.registrationClosesAt },
			{ label: 'Tables handed out', at: tournament.registrationClosesAt },
			{ label: 'First stage', at: tournament.startsAt }
		];
		const nextIndex = moments.findIndex((moment) => Date.parse(moment.at) > now);

		return moments.map((moment, index) => {
			if (nextIndex === -1 || index < nextIndex) {
				return { ...moment, state: 'done' };
			}

			return { ...moment, state: index === nextIndex ? 'next' : 'later' };
		});
	});

	/** How each step's dot and label look: done is quiet, next stands out, later waits. */
	const DOT: Record<Step['state'], string> = {
		done: 'bg-brass',
		next: 'border-2 border-brass',
		later: 'border-[1.5px] border-paper/35'
	};
	const LABEL: Record<Step['state'], string> = {
		done: 'text-paper/60',
		next: 'font-bold',
		later: 'text-paper/85'
	};

	const pool = $derived(tournament?.prizes.reduce((sum, prize) => sum + prize.coins, 0) ?? 0);

	const PLACE_SUFFIX = ['st', 'nd', 'rd'];
	/** "1st", "2nd", "3rd", "4th"… */
	const placeName = (place: number) => `${place}${PLACE_SUFFIX[place - 1] ?? 'th'}`;
	/** Gold, silver and bronze for the podium; the rest plain. */
	const MEDALS = ['bg-brass text-ink', 'bg-paper/75 text-ink', 'bg-rim-light text-paper'];
	const medal = (place: number) => MEDALS[place - 1] ?? 'bg-paper/12 text-paper';

	/** "Rina, Erdin and 3 more". */
	const whoSummary = $derived.by(() => {
		if (!tournament || tournament.players.length === 0) {
			return 'Nobody yet. Be the first.';
		}

		const named = tournament.players.slice(0, 2).join(', ');
		const others = tournament.registered - Math.min(tournament.players.length, 2);
		if (others <= 0) {
			return named;
		}

		return `${named} and ${others} more`;
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="tournament-title"
	class="modal max-h-[calc(100dvh-2rem)] overflow-hidden p-0 open:flex open:flex-col sm:w-[min(36rem,calc(100%-2rem))]"
>
	{#if tournament}
		<TournamentFelt
			label={status.label}
			dot={status.dot}
			startsAt={tournament.startsAt}
			countdown={startsIn(tournament.startsAt, now)}
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

		<!-- Only the details scroll: the felt stays on top and the action stays at the bottom. -->
		<div class="min-h-0 flex-1 space-y-7 overflow-y-auto p-6">
			<div>
				<h2 id="tournament-title" class="modal-title">{tournament.name}</h2>
				{#if format}
					<p class="mt-2 flex items-center gap-2 text-sm text-paper/60">
						<span
							class="rounded-md border border-brass/55 px-1.5 py-0.5 text-xs font-bold text-brass"
							>{format.label}</span
						>
						{format.note}
					</p>
				{/if}
				{#if tournament.description}
					<p class="mt-3 text-sm leading-relaxed whitespace-pre-line text-paper/80">
						{tournament.description}
					</p>
				{/if}
			</div>

			{#if tournament.prizes.length > 0}
				<section
					class="rounded-xl border border-brass/25 bg-black/30 px-4 pt-3 pb-1"
					aria-label="Prizes"
				>
					<p class="flex items-baseline justify-between gap-3">
						<span class="text-sm text-paper/55">Prize pool</span>
						<span class="text-lg font-extrabold text-brass">{coins(pool)}</span>
					</p>
					<ol class="mt-1 divide-y divide-paper/8">
						{#each tournament.prizes as prize (prize.place)}
							<li class="flex items-center gap-3 py-2.5">
								<span
									class="grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold {medal(
										prize.place
									)}"
									aria-hidden="true">{prize.place}</span
								>
								<span class="min-w-0 flex-1 truncate text-sm">
									<span class="font-semibold">{placeName(prize.place)}</span>
									{#if prize.extra}<span class="text-paper/55"> + {prize.extra}</span>{/if}
								</span>
								{#if prize.coins > 0}
									<span class="text-sm font-bold tabular-nums">{coins(prize.coins)}</span>
								{/if}
							</li>
						{/each}
					</ol>
				</section>
			{/if}

			<dl class="grid grid-cols-3 gap-2">
				<div class="rounded-lg bg-black/30 px-3 py-2">
					<dt class="text-xs text-paper/50">Fee</dt>
					<dd class="text-sm font-bold">{tournament.fee === 0 ? 'Free' : coins(tournament.fee)}</dd>
				</div>
				<div class="rounded-lg bg-black/30 px-3 py-2">
					<dt class="text-xs text-paper/50">Per table</dt>
					<dd class="text-sm font-bold">{tournament.playersPerRoom} players</dd>
				</div>
				{#if tournament.minPlayers !== null}
					<div class="rounded-lg bg-black/30 px-3 py-2">
						<dt class="text-xs text-paper/50">Players</dt>
						<dd class="text-sm font-bold">{tournament.minPlayers}–{tournament.maxPlayers}</dd>
					</div>
				{/if}
			</dl>

			<section aria-labelledby="schedule-title">
				<h3 id="schedule-title" class="font-display text-base font-bold">Schedule</h3>
				<ol class="mt-3">
					{#each schedule as step, index (step.label)}
						<li class="relative flex items-center gap-3 pb-4 last:pb-0">
							{#if index < schedule.length - 1}
								<span
									class="absolute top-4 bottom-0 left-[7px] w-0.5 {step.state === 'done'
										? 'bg-brass/50'
										: 'bg-paper/15'}"
									aria-hidden="true"
								></span>
							{/if}
							<span
								class="relative grid size-4 shrink-0 place-items-center rounded-full {DOT[
									step.state
								]}"
								aria-hidden="true"
							>
								{#if step.state === 'next'}
									<span class="size-1.5 rounded-full bg-brass"></span>
								{:else if step.state === 'done'}
									<svg viewBox="0 0 12 12" class="size-2.5 text-ink" fill="none" aria-hidden="true">
										<path
											d="M2.5 6.2l2.2 2.2 4.8-5"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
										/>
									</svg>
								{/if}
							</span>
							<span class="flex-1 text-sm {LABEL[step.state]}">
								{step.label}
								<span class="sr-only">({step.state})</span>
							</span>
							<span class="text-xs text-paper/60 tabular-nums">{when(step.at)}</span>
						</li>
					{/each}
				</ol>
			</section>

			{#if steps.length > 0}
				<section aria-labelledby="plays-title">
					<h3 id="plays-title" class="font-display text-base font-bold">How it plays</h3>
					<ol class="mt-3 space-y-2.5">
						{#each steps as line, index (line)}
							<li class="flex gap-3 text-sm text-paper/80">
								<span
									class="grid size-6 shrink-0 place-items-center rounded-md bg-brass/15 text-xs font-extrabold text-brass"
									aria-hidden="true">{index + 1}</span
								>
								<span class="pt-0.5">{line}</span>
							</li>
						{/each}
					</ol>
				</section>
			{/if}

			<section aria-labelledby="whos-in-title">
				<h3 id="whos-in-title" class="font-display text-base font-bold">Who’s in</h3>
				<div class="mt-3">
					<SignUpBar
						registered={tournament.registered}
						minPlayers={tournament.minPlayers}
						maxPlayers={tournament.maxPlayers}
						joined={tournament.joined}
						{full}
					/>
				</div>
				<div class="mt-4 flex items-center gap-3">
					{#if tournament.players.length > 0}
						<span class="flex -space-x-2" aria-hidden="true">
							{#each tournament.players as name, index (index)}
								<span
									class="grid size-8 place-items-center rounded-full text-sm font-bold text-paper ring-[3px] ring-panel {avatarTone(
										name
									)}">{name.charAt(0).toUpperCase()}</span
								>
							{/each}
						</span>
					{/if}
					<span class="min-w-0 flex-1 truncate text-sm text-paper/70">{whoSummary}</span>
					{#if tournament.joined}
						<span class="text-sm font-bold text-brass">You’re in</span>
					{/if}
				</div>
			</section>
		</div>

		<!-- The one action, kept in reach under the scrolling details. -->
		<div class="shrink-0 border-t border-paper/10 p-4 sm:px-6">
			<button
				class="{action.style} h-12 w-full rounded-xl text-base"
				onclick={onaction}
				disabled={action.disabled}
			>
				{action.label}
			</button>
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
