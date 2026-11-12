<script lang="ts">
	import { auditActor, auditLabel, auditNote, isAlarming } from '#lib/audit-actions.ts';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Audit log · Backoffice</title></svelte:head>

<PageHeader title="Audit log" description="Every admin sign-in and change, newest first." />

<section class="panel" aria-label="Audit entries">
	{#if data.rows.length === 0}
		<p class="px-5 py-10 text-center text-sm text-muted">
			{data.paged ? 'No older entries.' : 'Nothing logged yet.'}
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="data-table min-w-[56rem]">
				<thead>
					<tr>
						<th>When</th>
						<th>Admin</th>
						<th>Action</th>
						<th>Player</th>
						<th>Tournament</th>
						<th>Note</th>
						<th>IP</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.id)}
						<tr>
							<td class="whitespace-nowrap">{utc(row.createdAt)}</td>
							<td>{auditActor(row)}</td>
							<td class="font-medium {isAlarming(row.action) ? 'text-danger' : ''}"
								>{auditLabel(row.action)}</td
							>
							<td>
								{#if row.playerId}
									<a class="link" href="/players/{row.playerId}">{row.playerName ?? row.playerId}</a
									>
								{/if}
							</td>
							<td>
								{#if row.tournamentId}
									<a class="link" href="/tournaments/{row.tournamentId}">{row.tournamentName}</a>
								{/if}
							</td>
							<td class="text-muted">{auditNote(row)}</td>
							<td class="font-mono text-xs text-muted">{row.ip ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

{#if data.next}<a class="btn-quiet mt-4" href="?before={data.next}">Older entries</a>{/if}
