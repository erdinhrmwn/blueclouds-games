<script lang="ts">
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const nextHref = $derived(
		`?${new URLSearchParams({ ...(data.q ? { q: data.q } : {}), before: data.next ?? '' })}`
	);
</script>

<svelte:head><title>Players · Backoffice</title></svelte:head>

<h1 class="text-2xl font-semibold">Players</h1>

<form method="GET" class="mt-4 flex max-w-xl gap-2" role="search">
	<label class="sr-only" for="q">Search players</label>
	<input
		class="field"
		id="q"
		name="q"
		value={data.q}
		placeholder="Name, username or player id"
		maxlength="64"
	/>
	<button class="btn-primary">Search</button>
</form>

{#if data.players.length === 0}
	<p class="mt-6 text-muted">
		{#if data.q}No players match “{data.q}”.{:else if data.paged}No more players.{:else}No players
			yet.{/if}
	</p>
{:else}
	<div class="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
		<table class="w-full min-w-[48rem] text-left text-sm">
			<thead class="border-b border-line text-muted">
				<tr>
					<th class="px-3 py-2 font-medium">Name</th>
					<th class="px-3 py-2 font-medium">Account</th>
					<th class="px-3 py-2 font-medium">Player id</th>
					<th class="px-3 py-2 font-medium">Joined</th>
					<th class="px-3 py-2 font-medium">Last seen</th>
					<th class="px-3 py-2 font-medium">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.players as p (p.id)}
					<tr class="border-b border-line last:border-0 hover:bg-page">
						<td class="px-3 py-2"
							><a
								class="font-medium underline decoration-line underline-offset-2 hover:decoration-ink"
								href="/players/{p.id}">{p.name}</a
							></td
						>
						<td class="px-3 py-2">
							{p.isBot ? 'Bot' : p.isGuest ? 'Guest' : `@${p.username}`}{#if p.isVip}<span
									class="ml-2 rounded border border-line px-1.5 text-xs font-medium">VIP</span
								>{/if}
						</td>
						<td class="px-3 py-2 font-mono text-xs text-muted">{p.id}</td>
						<td class="px-3 py-2 whitespace-nowrap">{utc(p.createdAt)}</td>
						<td class="px-3 py-2 whitespace-nowrap">{utc(p.lastSeenAt)}</td>
						<td class="px-3 py-2"
							>{#if !p.isActive}<span class="font-medium text-danger">Disabled</span
								>{:else}Active{/if}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if data.next}
		<a class="btn-quiet mt-4" href={nextHref}>Older players</a>
	{/if}
{/if}
