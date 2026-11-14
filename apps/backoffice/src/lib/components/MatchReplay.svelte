<script lang="ts">
	import dayjs from 'dayjs';
	import durationPlugin from 'dayjs/plugin/duration';
	import type { Step } from '#lib/replay.ts';

	dayjs.extend(durationPlugin);

	type Props = {
		steps: Step[];
		/** A seat's player name, for the table view. */
		nameOf: (seat: number) => string;
	};

	let { steps, nameOf }: Props = $props();

	const SPEEDS = [0.5, 1, 2, 4];
	/** One step per this long at 1x. */
	const STEP_MS = 900;

	let at = $state(0);
	let playing = $state(false);
	let speed = $state(1);
	let timeline = $state<HTMLOListElement>();

	const last = $derived(steps.length - 1);
	const step = $derived(steps[Math.min(at, last)]!);
	const table = $derived(step.state);
	const flagged = $derived(steps.filter((s) => s.mismatch).length);
	/** Lives a seat starts with: the most anyone has at the first state, for the pips. */
	const startLives = $derived(
		Math.max(1, ...(steps.find((s) => s.state)?.state?.seats.map((seat) => seat.lives) ?? [1]))
	);

	/** The timeline cut into rounds; steps before the first deal sit under round 0 ("Setup"). */
	const rounds = $derived.by(() => {
		const groups: { round: number; items: { step: Step; index: number }[] }[] = [];

		steps.forEach((item, index) => {
			const round = item.state?.round ?? 0;
			const group = groups.at(-1);

			if (group && group.round === round) {
				group.items.push({ step: item, index });
				return;
			}

			groups.push({ round, items: [{ step: item, index }] });
		});

		return groups;
	});

	/** "+3:07": minutes and seconds since the match started. */
	const clock = (ms: number) => {
		const elapsed = dayjs.duration(Math.floor(Math.max(0, ms) / 1000), 'seconds');
		const minutes = Math.floor(elapsed.asMinutes());

		return `+${minutes}:${elapsed.format('ss')}`;
	};

	/** How a card label reads on a mini card: minus cards in red, words smaller. */
	const cardTone = (card: string) => {
		if (card.startsWith('-')) {
			return 'text-danger';
		}

		if (Number.isNaN(Number(card))) {
			return 'text-[0.625rem] leading-tight text-felt';
		}

		return '';
	};

	const goTo = (index: number) => {
		at = Math.min(last, Math.max(0, index));
	};

	const togglePlay = () => {
		if (!playing && at === last) {
			at = 0;
		}

		playing = !playing;
	};

	// Autoplay: one step per tick, stopping at the end.
	$effect(() => {
		if (!playing) {
			return;
		}

		const timer = setInterval(() => {
			if (at >= last) {
				playing = false;
				return;
			}

			at += 1;
		}, STEP_MS / speed);

		return () => clearInterval(timer);
	});

	$effect(() => {
		timeline?.querySelector(`[data-step="${at}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	/** ← → step, space plays or pauses, Home and End jump. Ignored while typing in a field. */
	const onKey = (event: KeyboardEvent) => {
		const typing =
			event.target instanceof Element && event.target.closest('input, select, textarea');
		if (typing) {
			return;
		}

		const actions: Record<string, () => void> = {
			ArrowLeft: () => goTo(at - 1),
			ArrowRight: () => goTo(at + 1),
			Home: () => goTo(0),
			End: () => goTo(last),
			' ': togglePlay
		};
		const action = actions[event.key];
		if (!action) {
			return;
		}

		event.preventDefault();
		action();
	};
</script>

<svelte:window onkeydown={onKey} />

<div class="space-y-6">
	<!-- Player bar -->
	<div class="rounded-lg border border-line bg-subtle p-4">
		<div class="flex flex-wrap items-center gap-2">
			<button class="btn-quiet min-h-10 px-3" onclick={() => goTo(0)} disabled={at === 0}
				>First</button
			>
			<button
				class="btn-quiet min-h-10 px-3"
				onclick={() => goTo(at - 1)}
				disabled={at === 0}
				aria-label="Previous step">Prev</button
			>
			<button class="btn-primary min-h-10 w-24" onclick={togglePlay} aria-pressed={playing}
				>{playing ? 'Pause' : 'Play'}</button
			>
			<button
				class="btn-quiet min-h-10 px-3"
				onclick={() => goTo(at + 1)}
				disabled={at === last}
				aria-label="Next step">Next</button
			>
			<button class="btn-quiet min-h-10 px-3" onclick={() => goTo(last)} disabled={at === last}
				>Last</button
			>
			<label class="ml-auto flex items-center gap-2 text-sm text-muted">
				Speed
				<select class="field min-h-10 w-auto py-0 pr-8 text-sm" bind:value={speed}>
					{#each SPEEDS as option (option)}<option value={option}>{option}x</option>{/each}
				</select>
			</label>
		</div>

		<label class="mt-4 block">
			<span class="sr-only">Step</span>
			<input class="h-6 w-full accent-felt" type="range" min="0" max={last} bind:value={at} />
		</label>
		<p class="mt-1 flex flex-wrap justify-between gap-x-4 text-sm text-muted tabular-nums">
			<span>Step {at + 1} of {steps.length} · {clock(step.event.t)}</span>
			<span class="hidden sm:inline">← → to step, space to play</span>
		</p>
	</div>

	<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
		<!-- What happened, and the table after it -->
		<div class="min-w-0 space-y-4" aria-live="polite">
			<div
				class="rounded-lg border px-4 py-3 {step.mismatch
					? 'border-danger/30 bg-danger-soft'
					: 'border-felt/20 bg-felt-soft'}"
			>
				<p class="font-medium {step.mismatch ? 'text-danger' : 'text-felt'}">{step.text}</p>
				{#if step.mismatch}
					<p class="mt-1 text-sm text-danger">The server logged something else: {step.mismatch}</p>
				{/if}
			</div>

			{#if table}
				<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="col-span-2 rounded-lg border border-line px-4 py-3">
						<dt class="text-sm text-muted">Total</dt>
						<dd class="mt-1 flex items-baseline gap-1.5">
							<span class="text-3xl font-semibold tracking-tight tabular-nums">{table.total}</span>
							<span class="text-sm text-muted">of {table.limit}</span>
						</dd>
						<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
							<div
								class="h-full rounded-full {table.total >= table.limit - 3
									? 'bg-danger'
									: 'bg-felt'}"
								style:width="{Math.min(100, Math.max(0, (table.total / table.limit) * 100))}%"
							></div>
						</div>
					</div>
					<div class="rounded-lg border border-line px-4 py-3">
						<dt class="text-sm text-muted">Round</dt>
						<dd class="mt-1 text-xl font-semibold tabular-nums">{table.round}</dd>
						<dd class="text-xs text-muted">
							{table.clockwise ? 'Clockwise' : 'Counter-clockwise'}
						</dd>
					</div>
					<div class="rounded-lg border border-line px-4 py-3">
						<dt class="text-sm text-muted">Pile</dt>
						<dd class="mt-1 text-xl font-semibold">{table.pileTop ?? 'Empty'}</dd>
						<dd class="text-xs text-muted tabular-nums">{table.deckCount} left in the deck</dd>
					</div>
				</dl>

				<ul class="grid gap-3 sm:grid-cols-2" aria-label="Seats">
					{#each table.seats as seat (seat.seat)}
						{@const turn = table.turnSeat === seat.seat}
						{@const out = seat.lives === 0}
						<li
							class="rounded-lg border p-4 {turn
								? 'border-felt bg-felt-soft ring-1 ring-felt'
								: 'border-line'} {out ? 'opacity-60' : ''}"
						>
							<div class="flex items-center gap-2">
								<span class="min-w-0 truncate font-medium">{nameOf(seat.seat)}</span>
								{#if turn}<span class="tag border-felt bg-felt font-semibold text-white">Turn</span
									>{/if}
								{#if seat.away}<span class="tag">Away</span>{/if}
								{#if out}<span class="tag-bad">Out</span>{/if}
								<span
									class="ml-auto flex gap-1"
									role="img"
									aria-label="{seat.lives} {seat.lives === 1 ? 'life' : 'lives'}"
								>
									{#each { length: startLives }, pip}
										<span class="size-2.5 rounded-full {pip < seat.lives ? 'bg-felt' : 'bg-line'}"
										></span>
									{/each}
								</span>
							</div>
							{#if seat.hand.length}
								<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Hand of {nameOf(seat.seat)}">
									{#each seat.hand as card, index (index)}
										<li
											class="grid h-12 w-9 place-items-center rounded-md border border-line bg-surface text-center text-sm font-semibold shadow-xs {cardTone(
												card
											)}"
										>
											{card}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="mt-3 text-sm text-muted">No cards in hand.</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Timeline -->
		<section class="min-w-0 self-start lg:sticky lg:top-20" aria-labelledby="timeline">
			<div class="flex items-baseline justify-between gap-2">
				<h3 id="timeline" class="font-semibold">Timeline</h3>
				<p class="text-sm {flagged ? 'font-medium text-danger' : 'text-muted'}">
					{flagged ? `${flagged} to check` : 'All steps match'}
				</p>
			</div>
			<ol
				bind:this={timeline}
				class="mt-2 max-h-[32rem] overflow-y-auto rounded-lg border border-line"
				aria-label="Timeline"
			>
				{#each rounds as group (group.items[0]!.index)}
					<li>
						<p
							class="sticky top-0 border-b border-line bg-subtle px-3 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase"
						>
							{group.round === 0 ? 'Setup' : `Round ${group.round}`}
						</p>
						<ol>
							{#each group.items as item (item.step.event.seq)}
								<li class="border-b border-line last:border-0">
									<button
										data-step={item.index}
										aria-current={item.index === at ? 'step' : undefined}
										class="grid min-h-11 w-full grid-cols-[3.25rem_1fr] items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-subtle aria-[current=step]:bg-felt-soft aria-[current=step]:font-semibold"
										onclick={() => goTo(item.index)}
									>
										<span class="text-xs text-muted tabular-nums">{clock(item.step.event.t)}</span>
										<span>
											{item.step.text}
											{#if item.step.mismatch}<span class="tag-bad ml-1">Check</span>{/if}
										</span>
									</button>
								</li>
							{/each}
						</ol>
					</li>
				{/each}
			</ol>
		</section>
	</div>
</div>
