<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const canEdit = $derived(data.admin?.role !== 'viewer');
</script>

<svelte:head><title>Games · Backoffice</title></svelte:head>

<PageHeader
	title="Games"
	description="Pause a game for maintenance: nobody opens a new table or tournament for it until you end it. Tables already open play on."
/>

{#if form && 'message' in form && form.message}
	<p class="panel mb-6 border-felt/30 bg-felt-soft px-4 py-3 text-sm text-felt" role="status">
		{form.message}
	</p>
{/if}
{#if form && 'error' in form && form.error}
	<p class="panel mb-6 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
		{form.error}
	</p>
{/if}

<section class="panel min-w-0" aria-labelledby="list">
	<div class="panel-head">
		<h2 id="list" class="font-semibold">All games</h2>
	</div>
	<div class="overflow-x-auto">
		<table class="data-table min-w-[32rem]">
			<thead>
				<tr>
					<th>Game</th>
					<th>Players</th>
					<th>Status</th>
					{#if canEdit}<th><span class="sr-only">Actions</span></th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each data.games as game (game.slug)}
					<tr>
						<td>
							{game.name}
							<span class="block font-mono text-xs text-muted">{game.slug}</span>
						</td>
						<td class="tabular-nums">{game.minPlayers}–{game.maxPlayers}</td>
						<td>
							{#if game.maintenanceAt}
								<span class="tag-bad">Under maintenance</span>
								<span class="mt-1 block text-xs text-muted">since {utc(game.maintenanceAt)}</span>
							{:else}
								<span class="tag-good">Open</span>
							{/if}
						</td>
						{#if canEdit}
							<td class="text-right">
								<form method="POST" action={game.maintenanceAt ? '?/end' : '?/start'} use:enhance>
									<input type="hidden" name="slug" value={game.slug} />
									<button class="btn-quiet" type="submit">
										{game.maintenanceAt ? 'End maintenance' : 'Start maintenance'}
									</button>
								</form>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
