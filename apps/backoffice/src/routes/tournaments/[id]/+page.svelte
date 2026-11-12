<script lang="ts">
	import { enhance } from '$app/forms';
	import { utc } from '#lib/format.ts';
	import { duration, tournamentStatus } from '#lib/tournament-status.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const t = $derived(data.tournament);
	const status = $derived(tournamentStatus(t));
	const live = $derived(!t.cancelledAt && !t.endedAt);
	const waiting = $derived(data.players.filter((p) => !p.roomCode));
	/** Tables that haven't started and still have a free seat. */
	const seatable = $derived(
		data.rooms.filter((r) => !r.startedAt && !r.closedAt && r.players < t.playersPerRoom)
	);
	let busy = $state(false);

	const submit = () => {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
	const roomState = (r: (typeof data.rooms)[number]) =>
		r.closeReason === 'finished'
			? `Finished after ${duration(r.startedAt ?? t.startsAt, r.closedAt!)}`
			: r.closeReason === 'not_enough_players'
				? 'Closed: not enough players showed up'
				: r.startedAt
					? `Playing since ${utc(r.startedAt)}`
					: 'Waiting for the start';
</script>

<svelte:head><title>{t.name} · Tournaments · Backoffice</title></svelte:head>

<a href="/tournaments" class="text-sm text-muted underline-offset-2 hover:underline">Tournaments</a>
<h1 class="mt-1 text-2xl font-semibold">{t.name}</h1>

<dl class="mt-4 grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
	<dt class="text-muted">Status</dt>
	<dd class={status.bad ? 'font-medium text-danger' : ''}>{status.label}</dd>
	<dt class="text-muted">Game</dt>
	<dd>{t.gameName}, {t.playersPerRoom} per table</dd>
	<dt class="text-muted">Starts</dt>
	<dd>{utc(t.startsAt)}</dd>
	<dt class="text-muted">Sign-up</dt>
	<dd>{utc(t.registrationOpensAt)} to {utc(t.registrationClosesAt)}</dd>
	{#if t.distributedAt}<dt class="text-muted">Tables handed out</dt>
		<dd>{utc(t.distributedAt)}</dd>{/if}
	{#if t.endedAt}<dt class="text-muted">Ended</dt>
		<dd>{utc(t.endedAt)}, ran {duration(t.startsAt, t.endedAt)}</dd>{/if}
	{#if t.cancelledAt}<dt class="text-muted">Cancelled</dt>
		<dd>{utc(t.cancelledAt)}</dd>{/if}
	<dt class="text-muted">Tournament id</dt>
	<dd class="font-mono text-xs leading-5 break-all">{t.id}</dd>
</dl>

{#if t.distributeError && !t.distributedAt && !t.cancelledAt}
	<p
		class="mt-4 max-w-2xl rounded-md border border-danger/40 px-3 py-2 text-sm text-danger"
		role="alert"
	>
		The tables couldn't be handed out: {t.distributeError} The platform tries again every minute.
	</p>
{/if}
{#if form?.message}<p class="mt-4 text-sm" role="status">{form.message}</p>{/if}
{#if form?.error}<p class="mt-4 text-sm text-danger" role="alert">{form.error}</p>{/if}

{#if live && !t.distributedAt}
	<section
		class="mt-6 max-w-2xl rounded-lg border border-line bg-surface p-4"
		aria-labelledby="register"
	>
		<h2 id="register" class="font-semibold">Register players</h2>
		<p class="mt-1 text-sm text-muted">
			Paste player ids, one per line or separated by commas. Players can also sign up themselves on
			the game's home page while sign-up is open.
		</p>
		<form method="POST" action="?/register" class="mt-3 space-y-3" use:enhance={submit}>
			<label class="label" for="ids">Player ids</label>
			<textarea class="field min-h-28 font-mono text-xs" id="ids" name="ids" required
				>{form && 'ids' in form ? form.ids : ''}</textarea
			>
			<button class="btn-primary" disabled={busy}>Register</button>
		</form>
	</section>

	<section
		class="mt-6 max-w-2xl rounded-lg border border-line bg-surface p-4"
		aria-labelledby="distribute"
	>
		<h2 id="distribute" class="font-semibold">Hand out tables</h2>
		<p class="mt-1 text-sm text-muted">
			This happens by itself at {utc(t.registrationClosesAt)}. Doing it now closes sign-up early and
			spreads the {t.registered} registered players over as few tables as fit, evenly.
		</p>
		<form method="POST" action="?/distribute" class="mt-3" use:enhance={submit}>
			<button class="btn-primary" disabled={busy || t.registered === 0}>Hand out tables now</button>
		</form>
	</section>
{/if}

{#if data.rooms.length}
	<h2 class="mt-8 font-semibold">Tables</h2>
	<div class="mt-2 grid gap-4 sm:grid-cols-2">
		{#each data.rooms as r (r.id)}
			<section class="rounded-lg border border-line bg-surface p-4" aria-label="Table {r.code}">
				<p class="flex items-baseline justify-between gap-2">
					<span class="font-mono text-lg tracking-[0.15em]">{r.code}</span>
					<span class="text-sm text-muted">{r.players}/{t.playersPerRoom}</span>
				</p>
				<p class="text-sm {r.closeReason === 'not_enough_players' ? 'text-danger' : 'text-muted'}">
					{roomState(r)}
				</p>
				<ol class="mt-2 space-y-1 text-sm">
					{#each data.players.filter((p) => p.roomCode === r.code) as p (p.playerId)}
						<li class="flex items-center justify-between gap-2">
							<span>
								<span class="text-muted tabular-nums">{(p.seat ?? 0) + 1}.</span>
								<a
									class="underline decoration-line underline-offset-2 hover:decoration-ink"
									href="/players/{p.playerId}">{p.name}</a
								>
								{#if p.disabled}<span class="text-danger">(disabled)</span>{/if}
							</span>
							{#if live && !r.startedAt && !r.closedAt}
								<form method="POST" action="?/unassign" use:enhance={submit}>
									<input type="hidden" name="playerId" value={p.playerId} />
									<button
										class="btn-quiet"
										disabled={busy}
										aria-label="Take {p.name} off table {r.code}">Take off</button
									>
								</form>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	</div>
{/if}

{#if live && seatable.length}
	<section
		class="mt-6 max-w-2xl rounded-lg border border-line bg-surface p-4"
		aria-labelledby="assign"
	>
		<h2 id="assign" class="font-semibold">Seat a player by hand</h2>
		<p class="mt-1 text-sm text-muted">
			For a latecomer, or after taking someone off. They get the table's first free seat and are
			registered if they weren't.
		</p>
		<form
			method="POST"
			action="?/assign"
			class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
			use:enhance={submit}
		>
			<div>
				<label class="label" for="playerId">Player id</label>
				<input
					class="field font-mono text-sm"
					id="playerId"
					name="playerId"
					maxlength="36"
					required
				/>
			</div>
			<div>
				<label class="label" for="room">Table</label>
				<select class="field" id="room" name="room">
					{#each seatable as r (r.id)}<option value={r.code}
							>{r.code} ({r.players}/{t.playersPerRoom})</option
						>{/each}
				</select>
			</div>
			<button class="btn-primary" disabled={busy}>Seat player</button>
		</form>
	</section>
{/if}

<h2 class="mt-8 font-semibold">
	{t.distributedAt ? 'Registered without a table' : 'Registered players'} ({t.distributedAt
		? waiting.length
		: data.players.length})
</h2>
{#if (t.distributedAt ? waiting : data.players).length === 0}
	<p class="mt-2 text-sm text-muted">{t.distributedAt ? 'Everyone has a table.' : 'Nobody yet.'}</p>
{:else}
	<ul class="mt-2 max-w-2xl divide-y divide-line rounded-lg border border-line bg-surface text-sm">
		{#each t.distributedAt ? waiting : data.players as p (p.playerId)}
			<li class="flex items-center justify-between gap-3 px-3 py-2">
				<span>
					<a
						class="underline decoration-line underline-offset-2 hover:decoration-ink"
						href="/players/{p.playerId}">{p.name}</a
					>
					<span class="text-muted">{p.byAdmin ? 'added by an admin' : 'signed up'}</span>
					{#if p.disabled}<span class="text-danger">(disabled, gets no table)</span>{/if}
				</span>
				{#if live}
					<form method="POST" action="?/unregister" use:enhance={submit}>
						<input type="hidden" name="playerId" value={p.playerId} />
						<button
							class="btn-quiet"
							disabled={busy}
							aria-label="Remove {p.name} from the tournament">Remove</button
						>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if live}
	<section
		class="mt-8 max-w-2xl rounded-lg border border-line bg-surface p-4"
		aria-labelledby="cancel"
	>
		<h2 id="cancel" class="font-semibold">Cancel tournament</h2>
		<p class="mt-1 text-sm text-muted">
			Its tables stop letting anyone in. Matches already played stay in the history. This can't be
			undone.
		</p>
		<form
			method="POST"
			action="?/cancel"
			class="mt-3"
			use:enhance={({ cancel }) => {
				if (!confirm(`Cancel ${t.name}?`)) return cancel();
				return submit();
			}}
		>
			<button class="btn-danger" disabled={busy}>Cancel tournament</button>
		</form>
	</section>
{/if}
