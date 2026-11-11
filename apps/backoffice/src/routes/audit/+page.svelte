<script lang="ts">
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ACTIONS: Record<string, string> = {
		login: 'Signed in',
		login_failed: 'Failed sign-in',
		logout: 'Signed out',
		'player.disable': 'Disabled player',
		'player.enable': 'Enabled player',
		'player.vip_grant': 'Made player VIP',
		'player.vip_revoke': 'Took VIP away',
		'tournament.create': 'Created tournament',
		'tournament.cancel': 'Cancelled tournament',
		'tournament.register': 'Registered players',
		'tournament.unregister': 'Unregistered player',
		'tournament.distribute': 'Handed out tables',
		'room.assign': 'Seated player',
		'room.unassign': 'Took player off table'
	};
	/** The one detail worth showing per action. */
	const note = (r: (typeof data.rows)[number]) => {
		if (r.action === 'login_failed') return `as “${r.detail.username}”`;
		if (typeof r.detail.reason === 'string') return `Reason: ${r.detail.reason}`;
		if (r.action === 'tournament.distribute') return `${r.detail.players} players, ${r.detail.rooms} tables${r.detail.auto ? ', automatic' : ''}`;
		if (r.action === 'tournament.register') return `${r.detail.players} players`;
		return r.roomCode ? `Table ${r.roomCode}` : '';
	};
</script>

<svelte:head><title>Audit log · Backoffice</title></svelte:head>

<h1 class="text-2xl font-semibold">Audit log</h1>
<p class="mt-1 text-sm text-muted">Every admin sign-in and change, newest first.</p>

{#if data.rows.length === 0}
	<p class="mt-6 text-muted">{data.paged ? 'No older entries.' : 'Nothing logged yet.'}</p>
{:else}
	<div class="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
		<table class="w-full min-w-[52rem] text-left text-sm">
			<thead class="border-b border-line text-muted">
				<tr>
					<th class="px-3 py-2 font-medium">When</th>
					<th class="px-3 py-2 font-medium">Admin</th>
					<th class="px-3 py-2 font-medium">Action</th>
					<th class="px-3 py-2 font-medium">Player</th>
					<th class="px-3 py-2 font-medium">Tournament</th>
					<th class="px-3 py-2 font-medium">Note</th>
					<th class="px-3 py-2 font-medium">IP</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr class="border-b border-line last:border-0">
						<td class="px-3 py-2 whitespace-nowrap">{utc(r.createdAt)}</td>
						<td class="px-3 py-2">{r.admin ?? (r.action === 'tournament.distribute' ? 'Platform' : '')}</td>
						<td class="px-3 py-2 {r.action === 'login_failed' || r.action === 'player.disable' ? 'text-danger' : ''}">{ACTIONS[r.action] ?? r.action}</td>
						<td class="px-3 py-2">
							{#if r.playerId}
								<a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/players/{r.playerId}">{r.playerName ?? r.playerId}</a>
							{/if}
						</td>
						<td class="px-3 py-2">
							{#if r.tournamentId}
								<a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/tournaments/{r.tournamentId}">{r.tournamentName}</a>
							{/if}
						</td>
						<td class="px-3 py-2">{note(r)}</td>
						<td class="px-3 py-2 font-mono text-xs text-muted">{r.ip ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if data.next}<a class="btn-quiet mt-4" href="?before={data.next}">Older entries</a>{/if}
{/if}
