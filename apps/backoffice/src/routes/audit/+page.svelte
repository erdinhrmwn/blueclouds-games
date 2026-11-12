<script lang="ts">
	import {
		AUDIT_ACTIONS,
		auditActor,
		auditLabel,
		auditNote,
		isAlarming
	} from '#lib/audit-actions.ts';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const filter = $derived(data.filter);
	const filtered = $derived(
		!!(filter.admin || filter.action || filter.player || filter.from || filter.to)
	);
	const emptyText = $derived.by(() => {
		if (filtered) return 'No entries fit these filters.';
		if (filter.before) return 'No older entries.';

		return 'Nothing logged yet.';
	});
	const nextHref = $derived.by(() => {
		const fields = Object.entries({ ...filter, before: data.next ?? '' });
		const params = new URLSearchParams(fields.filter(([, value]) => value));

		return `?${params}`;
	});
</script>

<svelte:head><title>Audit log · Backoffice</title></svelte:head>

<PageHeader title="Audit log" description="Every admin sign-in and change, newest first." />

<section class="panel" aria-label="Audit entries">
	<form
		method="GET"
		class="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end"
	>
		<div>
			<label class="label" for="admin">Admin</label>
			<select class="field" id="admin" name="admin" value={filter.admin}>
				<option value="">All admins</option>
				{#each data.admins as username (username)}<option value={username}>{username}</option
					>{/each}
			</select>
		</div>
		<div>
			<label class="label" for="action">Action</label>
			<select class="field" id="action" name="action" value={filter.action}>
				<option value="">All actions</option>
				{#each Object.entries(AUDIT_ACTIONS) as [action, label] (action)}
					<option value={action}>{label}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class="label" for="player">Player id</label>
			<input
				class="field font-mono text-sm"
				id="player"
				name="player"
				value={filter.player}
				maxlength="36"
			/>
		</div>
		<div>
			<label class="label" for="from">From (UTC)</label>
			<input class="field" id="from" name="from" type="date" value={filter.from} />
		</div>
		<div>
			<label class="label" for="to">To (UTC)</label>
			<input class="field" id="to" name="to" type="date" value={filter.to} />
		</div>
		<div class="flex gap-2 sm:col-span-2 lg:col-span-1">
			<button class="btn-primary">Filter</button>
			{#if filtered}<a class="btn-quiet" href="/audit">Clear</a>{/if}
		</div>
	</form>

	{#if data.rows.length === 0}
		<p class="px-5 py-10 text-center text-sm text-muted">{emptyText}</p>
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

{#if data.next}<a class="btn-quiet mt-4" href={nextHref}>Older entries</a>{/if}
