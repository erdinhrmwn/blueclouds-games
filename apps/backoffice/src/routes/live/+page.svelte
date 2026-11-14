<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { seatSlots } from '#lib/seat-slots.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Same limit as the server's REASON_MAX. */
	const REASON_MAX = 200;

	/** How often the list reloads by itself while the tab is visible. */
	const REFRESH_MS = 15_000;

	const PHASES = {
		lobby: { label: 'Waiting', tag: 'tag' },
		playing: { label: 'Playing', tag: 'tag-good' },
		finished: { label: 'Finished', tag: 'tag bg-subtle text-muted' }
	} as const;

	const KINDS = [
		{ value: '', label: 'All' },
		{ value: 'open', label: 'Open' },
		{ value: 'tournament', label: 'Tournament' }
	] as const;

	let game = $state('');
	let kind = $state<'' | 'open' | 'tournament'>('');
	let refreshing = $state(false);
	let now = $state(Date.now());

	/** The tables that fit the filters, empty ones last: they rarely need a look, but an admin may want to fill them. */
	const tables = $derived.by(() => {
		const fitting = data.tables.filter((table) => {
			const gameFits = !game || table.game === game;
			const kindFits = !kind || table.kind === kind;

			return gameFits && kindFits;
		});
		const taken = fitting.filter((table) => table.players > 0);
		const empty = fitting.filter((table) => table.players === 0);

		return [...taken, ...empty];
	});

	const stats = $derived([
		{ label: 'Live tables', value: data.tables.length },
		{
			label: 'Playing now',
			value: data.tables.filter((table) => table.phase === 'playing').length
		},
		{
			label: 'Players seated',
			value: data.tables.reduce((sum, table) => sum + table.players, 0)
		},
		{
			label: 'Tournament tables',
			value: data.tables.filter((table) => table.kind === 'tournament').length
		}
	]);

	const updated = $derived.by(() => {
		const seconds = Math.max(0, Math.round((now - new Date(data.checkedAt).getTime()) / 1000));
		if (seconds < 5) {
			return 'Updated just now';
		}

		if (seconds < 60) {
			return `Updated ${seconds}s ago`;
		}

		return `Updated ${Math.floor(seconds / 60)} min ago`;
	});

	const canManage = $derived(data.admin?.role !== 'viewer');

	// One dialog for every table: kick a player or terminate the table, with the reason both go to the logs with.
	let dialog = $state<HTMLDialogElement>();
	let managedCode = $state<string | null>(null);
	let acting = $state(false);
	/** The table being managed, as the latest refresh has it; null once it has left the list. */
	const managed = $derived(data.tables.find((table) => table.code === managedCode) ?? null);
	/** Humans sitting in a chair: the ones a kick can reach. */
	const kickable = $derived(
		(managed?.seats ?? []).filter((seat) => !seat.bot && seat.seat !== null)
	);

	const manage = (code: string) => {
		managedCode = code;
		dialog?.showModal();
	};

	const act = () => {
		acting = true;

		return async ({
			result,
			update
		}: {
			result: { type: string };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update();
			acting = false;

			if (result.type === 'success') {
				dialog?.close();
			}
		};
	};

	const refresh = async () => {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	};

	// Reload every REFRESH_MS while the tab is visible, and tick the "Updated" label every second.
	$effect(() => {
		const reload = setInterval(() => {
			if (document.visibilityState === 'visible' && !refreshing) {
				refresh();
			}
		}, REFRESH_MS);
		const tick = setInterval(() => {
			now = Date.now();
		}, 1000);

		return () => {
			clearInterval(reload);
			clearInterval(tick);
		};
	});
</script>

<svelte:head><title>Live tables · Backoffice</title></svelte:head>

<PageHeader
	title="Live tables"
	description="Open and tournament tables right now. Private tables don't report to the public list, so they aren't here."
>
	{#snippet actions()}
		<span class="self-center text-sm text-muted" aria-live="polite">{updated}</span>
		<button class="btn-quiet" onclick={refresh} disabled={refreshing}>
			{refreshing ? 'Refreshing…' : 'Refresh'}
		</button>
	{/snippet}
</PageHeader>

{#if form?.message}
	<p class="panel mb-6 border-felt/30 bg-felt-soft px-4 py-3 text-sm text-felt" role="status">
		{form.message}
	</p>
{/if}

<dl class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
	{#each stats as stat (stat.label)}
		<div class="panel p-4 sm:p-5">
			<dt class="text-sm font-medium text-muted">{stat.label}</dt>
			<dd class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{stat.value}</dd>
		</div>
	{/each}
</dl>

{#if data.unreachable.length}
	<p class="panel mt-6 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
		The game engine didn't answer for {data.unreachable.join(' and ')}, so its open tables are
		missing. Check that it's running, then refresh.
	</p>
{/if}

<section class="mt-8" aria-labelledby="tables">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h2 id="tables" class="font-semibold">
			Tables <span class="font-normal text-muted tabular-nums">({tables.length})</span>
		</h2>
		<div class="flex flex-wrap gap-2">
			<div class="flex rounded-lg border border-line p-0.5" role="group" aria-label="Game">
				{#each [{ slug: '', name: 'All games' }, ...data.games] as option (option.slug)}
					<button
						class="min-h-9 rounded-md px-3 text-sm font-medium text-muted hover:text-ink aria-pressed:bg-felt aria-pressed:text-white"
						aria-pressed={game === option.slug}
						onclick={() => (game = option.slug)}>{option.name}</button
					>
				{/each}
			</div>
			<div class="flex rounded-lg border border-line p-0.5" role="group" aria-label="Kind">
				{#each KINDS as option (option.value)}
					<button
						class="min-h-9 rounded-md px-3 text-sm font-medium text-muted hover:text-ink aria-pressed:bg-felt aria-pressed:text-white"
						aria-pressed={kind === option.value}
						onclick={() => (kind = option.value)}>{option.label}</button
					>
				{/each}
			</div>
		</div>
	</div>

	{#if tables.length === 0}
		<p class="panel px-5 py-12 text-center text-sm text-muted">
			{data.tables.length ? 'No table fits these filters.' : 'Nobody is at a table right now.'}
		</p>
	{:else}
		<ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each tables as table (table.code)}
				{@const phase = PHASES[table.phase]}
				{@const slots = seatSlots(table.seatCount, table.seats)}
				{@const canSeat =
					table.kind === 'tournament' && table.phase === 'lobby' && data.admin?.role !== 'viewer'}
				<li class="panel flex flex-col">
					<div class="flex items-center justify-between gap-3 px-5 pt-4">
						<div class="min-w-0">
							<p class="font-mono text-base tracking-[0.15em]">{table.code}</p>
							<p class="truncate text-sm text-muted">
								{table.gameName} ·
								{#if table.tournament}
									<a class="link" href="/tournaments/{table.tournament.id}"
										>{table.tournament.name}</a
									>
								{:else}
									Open table
								{/if}
							</p>
						</div>
						<span class="flex shrink-0 flex-wrap justify-end gap-1.5">
							{#if table.players === 0}<span class="tag bg-subtle text-muted">Empty table</span
								>{/if}
							<span class={phase.tag}>{phase.label}</span>
							{#if table.phase === 'playing' && table.round > 0}
								<span class="tag tabular-nums">Round {table.round}</span>
							{/if}
						</span>
					</div>

					<!-- The seats in order, one row: a player's initial, or + where the seat is free. -->
					<ol class="flex justify-between gap-1 px-5 py-5" aria-label="Seats at {table.code}">
						{#each slots as player, seat (seat)}
							<li class="flex w-12 min-w-0 flex-col items-center gap-1.5">
								{#if player}
									<svelte:element
										this={player.playerId ? 'a' : 'span'}
										href={player.playerId ? `/players/${player.playerId}` : undefined}
										class="grid size-11 place-items-center rounded-full text-sm font-semibold uppercase {player.bot
											? 'bg-line text-muted'
											: 'bg-felt text-white hover:bg-felt-deep'}"
										title="Seat {seat + 1}: {player.name}{player.bot ? ' (bot)' : ''}"
										>{player.name.slice(0, 1)}</svelte:element
									>
									<span class="max-w-full truncate text-xs font-medium">{player.name}</span>
								{:else if canSeat}
									<a
										class="grid size-11 place-items-center rounded-full border-2 border-dashed border-line text-xl leading-none text-muted hover:border-felt hover:text-felt"
										href="/tournaments/{table.tournament?.id}#assign"
										aria-label="Seat a player in seat {seat + 1}"
										title="Seat a player">+</a
									>
									<span class="text-xs text-muted">Seat {seat + 1}</span>
								{:else}
									<span
										class="grid size-11 place-items-center rounded-full border-2 border-dashed border-line text-xl leading-none text-muted"
										title="Seat {seat + 1}: empty">+</span
									>
									<span class="text-xs text-muted">Seat {seat + 1}</span>
								{/if}
							</li>
						{/each}
					</ol>

					<div class="mt-auto flex items-center gap-3 border-t border-line px-5 py-3 text-sm">
						<span class="tabular-nums">{table.players} of {table.seatCount} seats taken</span>
						<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
							<span
								class="block h-full rounded-full bg-felt"
								style:width="{(table.players / Math.max(1, table.seatCount)) * 100}%"
							></span>
						</span>
						{#if !table.tournament}
							<span class="truncate text-muted">Host {table.host ?? 'unknown'}</span>
						{/if}
						{#if canManage}
							<button
								class="btn-quiet min-h-9 px-3"
								onclick={() => manage(table.code)}
								aria-label="Manage table {table.code}">Manage</button
							>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<dialog
	bind:this={dialog}
	aria-labelledby="manage-title"
	class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/50"
	onclose={() => (managedCode = null)}
>
	<div class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
		<div class="min-w-0">
			<h2 id="manage-title" class="font-semibold">
				Manage table <span class="font-mono tracking-[0.15em]">{managedCode}</span>
			</h2>
			{#if managed}
				<p class="mt-0.5 truncate text-sm text-muted">
					{managed.gameName} · {PHASES[managed.phase].label}
					{#if managed.phase === 'playing' && managed.round > 0}· Round {managed.round}{/if}
				</p>
			{/if}
		</div>
		<button class="btn-quiet min-h-9 px-3" onclick={() => dialog?.close()}>Close</button>
	</div>

	{#if !managed}
		<p class="px-5 py-8 text-center text-sm text-muted">
			This table has left the list: everyone left, or it closed.
		</p>
	{:else}
		<form method="POST" class="space-y-6 px-5 py-5" use:enhance={act}>
			<input type="hidden" name="game" value={managed.game} />
			<input type="hidden" name="code" value={managed.code} />

			<div>
				<label class="label" for="reason">Reason</label>
				<textarea
					class="field min-h-20 py-2"
					id="reason"
					name="reason"
					maxlength={REASON_MAX}
					required
					aria-describedby="reason-hint"></textarea>
				<p id="reason-hint" class="mt-1.5 text-xs text-muted">
					Saved in the audit log, and in the match log when a match is running.
				</p>
			</div>

			<fieldset>
				<legend class="label">Kick a player</legend>
				{#if kickable.length === 0}
					<p class="text-sm text-muted">Nobody but bots sits at this table.</p>
				{:else}
					<ul class="divide-y divide-line rounded-md border border-line">
						{#each kickable as seat (seat.seat)}
							<li class="flex items-center justify-between gap-3 px-3 py-2">
								<span class="min-w-0 truncate text-sm">
									<span class="font-medium">{seat.name}</span>
									<span class="text-muted">· Seat {(seat.seat ?? 0) + 1}</span>
								</span>
								<button
									class="btn-quiet min-h-9 px-3"
									formaction="?/kick"
									name="seat"
									value={seat.seat}
									disabled={acting}>Kick</button
								>
							</li>
						{/each}
					</ul>
					<p class="mt-1.5 text-xs text-muted">
						{managed.phase === 'playing'
							? 'Mid-game their seat is played for them until the match ends.'
							: 'Their seat empties.'}
						They can't come back to this table.
					</p>
				{/if}
			</fieldset>

			<div class="rounded-md border border-danger/30 bg-danger-soft p-4">
				<p class="text-sm font-semibold text-danger">Terminate table</p>
				<p class="mt-1 text-sm text-danger">
					Everyone is sent away and nobody can play here again.
					{managed.phase === 'playing' ? 'The match is saved as terminated and counts no win.' : ''}
				</p>
				<button class="btn-danger mt-3" formaction="?/terminate" disabled={acting}
					>Terminate table</button
				>
			</div>

			{#if form?.error && form.code === managed.code}
				<p class="text-sm text-danger" role="alert">{form.error}</p>
			{/if}
		</form>
	{/if}
</dialog>
