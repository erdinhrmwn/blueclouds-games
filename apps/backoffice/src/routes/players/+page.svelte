<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { PLAYER_TYPE_TAG, playerType, utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const filter = $derived(data.filter);
	const filtered = $derived(!!(filter.q || filter.type || filter.status));

	const nextHref = $derived.by(() => {
		const fields = Object.entries({ ...filter, before: data.next ?? '' });
		const params = new URLSearchParams(fields.filter(([, value]) => value));

		return `?${params}`;
	});

	const accountOf = (player: (typeof data.players)[number]) => {
		if (player.isBot) return 'System';
		if (player.isGuest) return 'Guest';

		return `@${player.username}`;
	};

	const emptyText = $derived.by(() => {
		if (filtered) return 'No players fit these filters.';
		if (data.paged) return 'No more players.';

		return 'No players yet.';
	});
</script>

<svelte:head><title>Players · Backoffice</title></svelte:head>

<PageHeader
	title="Players"
	description="Everyone who has played, newest first. Open a player to disable them or change VIP."
/>

<section class="panel" aria-label="Player list">
	<form
		method="GET"
		role="search"
		class="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto] lg:items-end"
	>
		<div class="sm:col-span-2 lg:col-span-1">
			<label class="label" for="q">Search</label>
			<div class="relative">
				<span
					class="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted"
				>
					<Icon name="search" class="size-4" />
				</span>
				<input
					class="field pl-9"
					id="q"
					name="q"
					value={filter.q}
					placeholder="Name, username or player id"
					maxlength="64"
				/>
			</div>
		</div>
		<div>
			<label class="label" for="type">Type</label>
			<select class="field" id="type" name="type" value={filter.type}>
				<option value="">All types</option>
				<option value="normal">Normal</option>
				<option value="vip">VIP</option>
				<option value="bot">Bot</option>
			</select>
		</div>
		<div>
			<label class="label" for="status">Status</label>
			<select class="field" id="status" name="status" value={filter.status}>
				<option value="">Active and disabled</option>
				<option value="active">Active</option>
				<option value="disabled">Disabled</option>
			</select>
		</div>
		<div class="flex gap-2 sm:col-span-2 lg:col-span-1">
			<button class="btn-primary">Filter</button>
			{#if filtered}<a class="btn-quiet" href="/players">Clear</a>{/if}
		</div>
	</form>

	{#if data.players.length === 0}
		<p class="px-5 py-10 text-center text-sm text-muted">{emptyText}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="data-table min-w-[52rem]">
				<thead>
					<tr>
						<th>Name</th>
						<th>Type</th>
						<th>Account</th>
						<th>Player id</th>
						<th>Joined</th>
						<th>Last seen</th>
						<th>Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.players as player (player.id)}
						{@const type = playerType(player)}
						<tr>
							<td>
								<a class="link font-medium" href="/players/{player.id}">{player.name}</a>
							</td>
							<td><span class={PLAYER_TYPE_TAG[type]}>{type}</span></td>
							<td>{accountOf(player)}</td>
							<td class="font-mono text-xs text-muted">{player.id}</td>
							<td class="whitespace-nowrap">{utc(player.createdAt)}</td>
							<td class="whitespace-nowrap">{utc(player.lastSeenAt)}</td>
							<td>
								{#if player.isActive}
									<span class="tag-good">Active</span>
								{:else}
									<span class="tag-bad">Disabled</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

{#if data.next}
	<a class="btn-quiet mt-4" href={nextHref}>Older players</a>
{/if}
