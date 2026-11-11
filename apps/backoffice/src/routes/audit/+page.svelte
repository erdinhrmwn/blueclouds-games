<script lang="ts">
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ACTIONS: Record<string, string> = {
		login: 'Signed in',
		login_failed: 'Failed sign-in',
		logout: 'Signed out',
		'player.disable': 'Disabled player',
		'player.enable': 'Enabled player'
	};
	/** The one detail worth showing per action. */
	const note = (r: (typeof data.rows)[number]) =>
		r.action === 'login_failed' ? `as “${r.detail.username}”` : typeof r.detail.reason === 'string' ? `Reason: ${r.detail.reason}` : '';
</script>

<svelte:head><title>Audit log · Backoffice</title></svelte:head>

<h1 class="text-2xl font-semibold">Audit log</h1>
<p class="mt-1 text-sm text-muted">Every admin sign-in and change, newest first.</p>

{#if data.rows.length === 0}
	<p class="mt-6 text-muted">{data.paged ? 'No older entries.' : 'Nothing logged yet.'}</p>
{:else}
	<div class="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
		<table class="w-full min-w-[44rem] text-left text-sm">
			<thead class="border-b border-line text-muted">
				<tr>
					<th class="px-3 py-2 font-medium">When</th>
					<th class="px-3 py-2 font-medium">Admin</th>
					<th class="px-3 py-2 font-medium">Action</th>
					<th class="px-3 py-2 font-medium">Player</th>
					<th class="px-3 py-2 font-medium">Note</th>
					<th class="px-3 py-2 font-medium">IP</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr class="border-b border-line last:border-0">
						<td class="px-3 py-2 whitespace-nowrap">{utc(r.createdAt)}</td>
						<td class="px-3 py-2">{r.admin ?? ''}</td>
						<td class="px-3 py-2 {r.action === 'login_failed' || r.action === 'player.disable' ? 'text-danger' : ''}">{ACTIONS[r.action] ?? r.action}</td>
						<td class="px-3 py-2">
							{#if r.playerId}
								<a class="underline decoration-line underline-offset-2 hover:decoration-ink" href="/players/{r.playerId}">{r.playerName ?? r.playerId}</a>
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
