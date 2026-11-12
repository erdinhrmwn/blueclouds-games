<script lang="ts">
	import { enhance } from '$app/forms';
	import { playerType, utc } from '#lib/format.ts';
	import { REASON_MAX } from '#lib/limits.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const player = $derived(data.player);
	const account = $derived.by(() => {
		if (player.isBot) return 'Run by the system';
		if (player.isGuest) return player.username ? `Guest @${player.username}` : 'Guest';
		return `@${player.username}`;
	});
	let busy = $state(false);

	const submit = () => {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head><title>{player.name} · Players · Backoffice</title></svelte:head>

<a href="/players" class="text-sm text-muted underline-offset-2 hover:underline">Players</a>
<h1 class="mt-1 text-2xl font-semibold">{player.name}</h1>

<dl class="mt-4 grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
	<dt class="text-muted">Player id</dt>
	<dd class="font-mono text-xs leading-5 break-all">{player.id}</dd>
	<dt class="text-muted">Type</dt>
	<dd>{playerType(player)}</dd>
	<dt class="text-muted">Account</dt>
	<dd>{account}</dd>
	<dt class="text-muted">Joined</dt>
	<dd>{utc(player.createdAt)}</dd>
	<dt class="text-muted">Last seen</dt>
	<dd>{utc(player.lastSeenAt)}</dd>
	<dt class="text-muted">Status</dt>
	<dd>
		{#if player.disabledAt}
			<span class="font-medium text-danger">Disabled</span> since {utc(player.disabledAt)}: {player.disabledReason}
		{:else}
			Active
		{/if}
	</dd>
</dl>

{#if form?.message}<p class="mt-4 text-sm" role="status">{form.message}</p>{/if}
{#if form?.error}<p class="mt-4 text-sm text-danger" role="alert">{form.error}</p>{/if}

<section
	class="mt-6 max-w-2xl rounded-lg border border-line bg-surface p-4"
	aria-labelledby="access"
>
	<h2 id="access" class="font-semibold">Access</h2>
	{#if player.disabledAt}
		<p class="mt-1 text-sm text-muted">
			Enabling lets them play again. Their old browser session stays signed out.
		</p>
		<form method="POST" action="?/enable" class="mt-3" use:enhance={submit}>
			<button class="btn-primary" disabled={busy}>Enable player</button>
		</form>
	{:else}
		<p class="mt-1 text-sm text-muted">
			Disabling signs them out everywhere and stops them joining tables. The reason is kept in the
			audit log.
		</p>
		<form method="POST" action="?/disable" class="mt-3 space-y-3" use:enhance={submit}>
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
			<button class="btn-danger" disabled={busy}>Disable player</button>
		</form>
	{/if}
</section>

<section class="mt-6 max-w-2xl rounded-lg border border-line bg-surface p-4" aria-labelledby="vip">
	<h2 id="vip" class="font-semibold">VIP</h2>
	<p class="mt-1 text-sm text-muted">
		{player.isVip
			? 'This player is a VIP.'
			: 'Mark a player as VIP. The change is kept in the audit log.'}
	</p>
	<form
		method="POST"
		action={player.isVip ? '?/revokeVip' : '?/grantVip'}
		class="mt-3"
		use:enhance={submit}
	>
		<button class={player.isVip ? 'btn-quiet' : 'btn-primary'} disabled={busy}
			>{player.isVip ? 'Take VIP away' : 'Make VIP'}</button
		>
	</form>
</section>

<div class="mt-8 flex items-baseline justify-between gap-4">
	<h2 class="font-semibold">Recent matches</h2>
	{#if data.matches.length}<a
			class="text-sm underline underline-offset-2"
			href="/matches?player={player.id}">All their matches</a
		>{/if}
</div>
{#if data.matches.length === 0}
	<p class="mt-2 text-sm text-muted">No finished matches yet.</p>
{:else}
	<div class="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
		<table class="w-full min-w-[32rem] text-left text-sm">
			<thead class="border-b border-line text-muted">
				<tr>
					<th class="px-3 py-2 font-medium">Ended</th>
					<th class="px-3 py-2 font-medium">Game</th>
					<th class="px-3 py-2 font-medium">Table</th>
					<th class="px-3 py-2 font-medium">Place</th>
				</tr>
			</thead>
			<tbody>
				{#each data.matches as m (m.id)}
					<tr class="border-b border-line last:border-0">
						<td class="px-3 py-2 whitespace-nowrap">
							<a
								class="underline decoration-line underline-offset-2 hover:decoration-ink"
								href="/matches/{m.id}">{utc(m.endedAt)}</a
							>
						</td>
						<td class="px-3 py-2">{m.gameName}</td>
						<td class="px-3 py-2 font-mono text-xs">{m.roomCode}</td>
						<td class="px-3 py-2">{m.placement} of {m.players}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
