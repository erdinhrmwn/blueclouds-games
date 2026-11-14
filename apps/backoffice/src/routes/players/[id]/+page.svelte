<script lang="ts">
	import { enhance } from '$app/forms';
	import { auditActor, auditLabel, auditNote, isAlarming } from '#lib/audit-actions.ts';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { PLAYER_TYPE_TAG, playerType, utc } from '#lib/format.ts';
	import { REASON_MAX } from '#lib/limits.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const player = $derived(data.player);
	const type = $derived(playerType(player));
	const account = $derived.by(() => {
		if (player.isBot) {
			return 'Run by the system';
		}

		if (player.isGuest) {
			return player.username ? `Guest @${player.username}` : 'Guest';
		}

		return `@${player.username}`;
	});
	const winRate = $derived.by(() => {
		const { played, won } = data.stats;
		if (played === 0) {
			return '–';
		}

		return `${Math.round((won / played) * 100)}%`;
	});
	let busy = $state(false);

	const submit = () => {
		busy = true;

		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};

	const COIN_REASONS: Record<string, string> = {
		signup_bonus: 'Account bonus',
		admin_grant: 'Added by an admin',
		admin_take: 'Taken by an admin',
		tournament_fee: 'Fee',
		tournament_refund: 'Refund',
		tournament_prize: 'Prize'
	};

	/** "Fee · Night Owls", "Added by an admin · launch gift". */
	function coinLabel(row: (typeof data.coinHistory)[number]): string {
		const label = COIN_REASONS[row.reason] ?? row.reason;
		const about = row.tournament?.name ?? row.note;

		return about ? `${label} · ${about}` : label;
	}
</script>

<svelte:head><title>{player.name} · Players · Backoffice</title></svelte:head>

<PageHeader title={player.name} parent={{ href: '/players', label: 'Players' }}>
	{#snippet actions()}
		<span class={PLAYER_TYPE_TAG[type]}>{type}</span>
		{#if player.disabledAt}
			<span class="tag-bad">Disabled</span>
		{:else}
			<span class="tag-good">Active</span>
		{/if}
	{/snippet}
</PageHeader>

{#if form?.message}
	<p class="panel mb-6 border-felt/30 bg-felt-soft px-4 py-3 text-sm text-felt" role="status">
		{form.message}
	</p>
{/if}
{#if form?.error}
	<p class="panel mb-6 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
		{form.error}
	</p>
{/if}

<div class="grid gap-6 lg:grid-cols-3 lg:items-start">
	<section class="panel min-w-0 lg:col-span-2" aria-labelledby="details">
		<div class="panel-head">
			<h2 id="details" class="font-semibold">Details</h2>
		</div>
		<dl class="grid grid-cols-3 divide-x divide-line border-b border-line">
			{#each [['Matches played', data.stats.played], ['Won', data.stats.won], ['Win rate', winRate]] as [label, value] (label)}
				<div class="px-5 py-4">
					<dt class="text-sm text-muted">{label}</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
				</div>
			{/each}
		</dl>
		<dl class="facts">
			<dt>Player id</dt>
			<dd class="font-mono text-xs leading-5 break-all">{player.id}</dd>
			<dt>Type</dt>
			<dd>{type}</dd>
			<dt>Account</dt>
			<dd>{account}</dd>
			<dt>Joined</dt>
			<dd>{utc(player.createdAt)}</dd>
			<dt>Last seen</dt>
			<dd>{utc(player.lastSeenAt)}</dd>
			<dt>Status</dt>
			<dd>
				{#if player.disabledAt}
					<span class="font-medium text-danger">Disabled</span> since {utc(player.disabledAt)}: {player.disabledReason}
				{:else}
					Active
				{/if}
			</dd>
		</dl>
	</section>

	<div class="space-y-6 lg:row-span-2">
		{#if data.admin?.role === 'viewer'}
			<p class="panel px-5 py-4 text-sm text-muted">
				You have view-only access, so disabling and VIP changes are hidden.
			</p>
		{:else}
			<section class="panel" aria-labelledby="access">
				<div class="panel-head">
					<h2 id="access" class="font-semibold">Access</h2>
				</div>
				<div class="px-5 py-4">
					{#if player.disabledAt}
						<p class="text-sm text-muted">
							Enabling lets them play again. Their old browser session stays signed out.
						</p>
						<form method="POST" action="?/enable" class="mt-4" use:enhance={submit}>
							<button class="btn-primary w-full" disabled={busy}>Enable player</button>
						</form>
					{:else}
						<p class="text-sm text-muted">
							Disabling signs them out everywhere and stops them joining tables. The reason is kept
							in the audit log.
						</p>
						<form method="POST" action="?/disable" class="mt-4 space-y-3" use:enhance={submit}>
							<div>
								<label class="label" for="reason">Reason</label>
								<input
									class="field"
									id="reason"
									name="reason"
									value={form?.reason ?? ''}
									maxlength={REASON_MAX}
									required
								/>
							</div>
							<button class="btn-danger w-full" disabled={busy}>Disable player</button>
						</form>
					{/if}
				</div>
			</section>

			<section class="panel" aria-labelledby="vip">
				<div class="panel-head">
					<h2 id="vip" class="font-semibold">VIP</h2>
					{#if player.isVip}<span class="tag-vip">VIP</span>{/if}
				</div>
				<div class="px-5 py-4">
					<p class="text-sm text-muted">
						{player.isVip
							? 'This player is a VIP. Every player at their table sees the tag.'
							: 'Mark a player as VIP. The change is kept in the audit log.'}
					</p>
					<form
						method="POST"
						action={player.isVip ? '?/revokeVip' : '?/grantVip'}
						class="mt-4"
						use:enhance={submit}
					>
						<button class="{player.isVip ? 'btn-quiet' : 'btn-primary'} w-full" disabled={busy}
							>{player.isVip ? 'Take VIP away' : 'Make VIP'}</button
						>
					</form>
				</div>
			</section>
		{/if}

		<section class="panel" aria-labelledby="coins">
			<div class="panel-head">
				<h2 id="coins" class="font-semibold">Coins</h2>
				<span class="font-semibold tabular-nums">{data.coins.toLocaleString('en')}</span>
			</div>
			{#if data.coinHistory.length === 0}
				<p class="px-5 py-4 text-sm text-muted">No coins have moved yet.</p>
			{:else}
				<ul class="divide-y divide-line text-sm">
					{#each data.coinHistory as row (row.id)}
						<li class="flex items-baseline justify-between gap-3 px-5 py-2.5">
							<span class="min-w-0">
								<span class="font-medium">{coinLabel(row)}</span>
								<span class="block text-xs text-muted">{utc(new Date(row.at))}</span>
							</span>
							<span class="font-semibold tabular-nums {row.amount > 0 ? 'text-felt' : ''}"
								>{row.amount > 0 ? '+' : ''}{row.amount.toLocaleString('en')}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
			{#if data.admin?.role !== 'viewer'}
				<form
					method="POST"
					action="?/adjustCoins"
					class="space-y-3 border-t border-line px-5 py-4"
					use:enhance={submit}
				>
					{#if form?.coinError}<p class="text-sm text-danger" role="alert">{form.coinError}</p>{/if}
					<div>
						<label class="label" for="amount">Coins to add (minus to take away)</label>
						<input
							class="field"
							id="amount"
							name="amount"
							type="number"
							step="1"
							value={form?.amount ?? ''}
							required
							placeholder="500"
						/>
					</div>
					<div>
						<label class="label" for="note">Why (the player sees this)</label>
						<input
							class="field"
							id="note"
							name="note"
							value={form?.note ?? ''}
							maxlength={REASON_MAX}
							required
							placeholder="Launch gift"
						/>
					</div>
					<button class="btn-primary w-full" disabled={busy}>Change coins</button>
				</form>
			{/if}
		</section>

		<section class="panel" aria-labelledby="history">
			<div class="panel-head">
				<h2 id="history" class="font-semibold">Admin history</h2>
				{#if data.audit.length}
					<a class="link text-sm" href="/audit?player={player.id}">Full history</a>
				{/if}
			</div>
			{#if data.audit.length === 0}
				<p class="px-5 py-6 text-sm text-muted">No admin has changed this player.</p>
			{:else}
				<ul class="divide-y divide-line">
					{#each data.audit as row (row.id)}
						{@const byline = [auditActor(row), auditNote(row)].filter(Boolean).join(' · ')}
						<li class="px-5 py-3 text-sm">
							<p class="flex flex-wrap items-baseline justify-between gap-x-3">
								<span class="font-medium {isAlarming(row.action) ? 'text-danger' : ''}"
									>{auditLabel(row.action)}</span
								>
								<span class="text-xs whitespace-nowrap text-muted">{utc(row.createdAt)}</span>
							</p>
							{#if byline}
								<p class="mt-0.5 text-muted">{byline}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<section class="panel min-w-0 lg:col-span-2" aria-labelledby="matches">
		<div class="panel-head">
			<h2 id="matches" class="font-semibold">Recent matches</h2>
			{#if data.matches.length}
				<a class="link text-sm" href="/matches?player={player.id}">All their matches</a>
			{/if}
		</div>
		{#if data.matches.length === 0}
			<p class="px-5 py-8 text-sm text-muted">No finished matches yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="data-table min-w-[32rem]">
					<thead>
						<tr>
							<th>Ended</th>
							<th>Game</th>
							<th>Table</th>
							<th>Place</th>
						</tr>
					</thead>
					<tbody>
						{#each data.matches as match (match.id)}
							{@const won = match.placement === 1 && match.endReason === 'finished'}
							<tr>
								<td class="whitespace-nowrap">
									<a class="link" href="/matches/{match.id}">{utc(match.endedAt)}</a>
								</td>
								<td>{match.gameName}</td>
								<td class="font-mono text-xs">{match.roomCode}</td>
								<td class="tabular-nums {won ? 'font-semibold text-felt' : ''}">
									{match.placement} of {match.players}
									{#if match.endReason === 'terminated'}
										<span class="ml-1 tag-bad">Terminated</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
