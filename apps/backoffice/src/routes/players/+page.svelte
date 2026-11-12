<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { PLAYER_TYPE_TAG, playerType, utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const nextHref = $derived.by(() => {
		const params = new URLSearchParams();
		if (data.q) {
			params.set('q', data.q);
		}
		params.set('before', data.next ?? '');

		return `?${params}`;
	});

	const accountOf = (player: (typeof data.players)[number]) => {
		if (player.isBot) return 'System';
		if (player.isGuest) return 'Guest';

		return `@${player.username}`;
	};

	const emptyText = $derived.by(() => {
		if (data.q) return `No players match “${data.q}”.`;
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
	<div class="panel-head">
		<form method="GET" class="flex w-full max-w-xl gap-2" role="search">
			<div class="relative flex-1">
				<label class="sr-only" for="q">Search players</label>
				<span
					class="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted"
				>
					<Icon name="search" class="size-4" />
				</span>
				<input
					class="field pl-9"
					id="q"
					name="q"
					value={data.q}
					placeholder="Name, username or player id"
					maxlength="64"
				/>
			</div>
			<button class="btn-primary">Search</button>
		</form>
		{#if data.q}
			<a class="link text-sm" href="/players">Clear search</a>
		{/if}
	</div>

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
