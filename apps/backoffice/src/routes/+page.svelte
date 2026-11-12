<script lang="ts">
	import { auditActor, auditLabel, auditNote, isAlarming } from '#lib/audit-actions.ts';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const players = $derived(data.stats.players);
	const matches = $derived(data.stats.matches);
	const tournaments = $derived(data.stats.tournaments);

	const busiestDay = $derived(Math.max(1, ...data.days.map((day) => day.matches)));
	const chartTotal = $derived(data.days.reduce((sum, day) => sum + day.matches, 0));

	const accounts = $derived([
		{ label: 'Normal', count: players.total - players.vip, dot: 'bg-muted', query: 'type=normal' },
		{ label: 'VIP', count: players.vip, dot: 'bg-brass', query: 'type=vip' },
		{ label: 'Bot', count: players.bots, dot: 'bg-line', query: 'type=bot' },
		{ label: 'Disabled', count: players.disabled, dot: 'bg-danger', query: 'status=disabled' }
	]);

	/** "Nov 12", for a UTC day from the chart. */
	const shortDay = (day: string) =>
		new Date(`${day}T00:00:00Z`).toLocaleDateString('en', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});

	const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
</script>

<svelte:head><title>Overview · Backoffice</title></svelte:head>

<PageHeader title="Overview" description="What happened across every game in the last 24 hours." />

{#snippet stat(label: string, value: number, note: string, href: string, alert = false)}
	<a
		{href}
		class="panel group flex flex-col p-4 transition-colors sm:p-5 hover:border-ink/25 {alert
			? 'border-danger/40'
			: ''}"
	>
		<span class="flex items-center justify-between text-sm font-medium text-muted">
			{label}
			<Icon
				name="arrowRight"
				class="size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
			/>
		</span>
		<span class="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
		<span class="mt-1 text-sm {alert ? 'font-medium text-danger' : 'text-muted'}">{note}</span>
	</a>
{/snippet}

<section aria-label="Key numbers" class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
	{@render stat('Players', players.total, `${players.joinedLastDay} joined in 24 h`, '/players')}
	{@render stat(
		'Seen in 24 h',
		players.seenLastDay,
		`of ${players.total} ${plural(players.total, 'player', 'players')}`,
		'/players'
	)}
	{@render stat('Matches in 24 h', matches.lastDay, `${matches.total} played in all`, '/matches')}
	{@render stat(
		'Open tournaments',
		tournaments.open,
		tournaments.needAttention
			? `${tournaments.needAttention} ${plural(tournaments.needAttention, 'needs', 'need')} attention`
			: 'Nothing needs attention',
		'/tournaments',
		tournaments.needAttention > 0
	)}
</section>

<div class="mt-6 grid gap-6 lg:grid-cols-3">
	<section class="panel lg:col-span-2" aria-labelledby="per-day">
		<div class="panel-head">
			<div>
				<h2 id="per-day" class="font-semibold">Matches per day</h2>
				<p class="text-sm text-muted">Last {data.days.length} days, by UTC day the match ended</p>
			</div>
			<p class="text-sm text-muted">
				<span class="font-semibold text-ink tabular-nums">{chartTotal}</span>
				{plural(chartTotal, 'match', 'matches')}
			</p>
		</div>
		<ol class="flex h-56 items-end gap-1 px-5 pt-6 pb-4 sm:gap-2" aria-label="Matches per day">
			{#each data.days as day, index (day.day)}
				{@const today = index === data.days.length - 1}
				<li class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
					<span class="sr-only"
						>{shortDay(day.day)}: {day.matches} {plural(day.matches, 'match', 'matches')}</span
					>
					<span class="text-xs text-muted tabular-nums" aria-hidden="true">{day.matches || ''}</span
					>
					<span
						class="w-full max-w-8 rounded-t {today ? 'bg-felt' : 'bg-felt/35'}"
						style:height="{Math.max(2, (day.matches / busiestDay) * 100)}%"
						title="{shortDay(day.day)}: {day.matches}"
						aria-hidden="true"
					></span>
					<span
						class="text-[0.6875rem] tabular-nums {today ? 'font-semibold text-ink' : 'text-muted'}"
						aria-hidden="true">{day.day.slice(8)}</span
					>
				</li>
			{/each}
		</ol>
	</section>

	<section class="panel" aria-labelledby="accounts">
		<div class="panel-head">
			<h2 id="accounts" class="font-semibold">Accounts by type</h2>
		</div>
		<ul class="divide-y divide-line px-2">
			{#each accounts as account (account.label)}
				{@const alarming = account.label === 'Disabled' && account.count > 0}
				<li>
					<a
						href="/players?{account.query}"
						class="flex min-h-11 items-center gap-3 rounded-md px-3 py-1.5 text-sm hover:bg-subtle"
					>
						<span class="size-2.5 rounded-full {account.dot}" aria-hidden="true"></span>
						{account.label}
						<span class="ml-auto font-semibold tabular-nums {alarming ? 'text-danger' : ''}"
							>{account.count}</span
						>
					</a>
				</li>
			{/each}
		</ul>
		<p class="px-5 pb-5 text-xs text-muted">
			Normal and VIP count people; disabled covers every type.
		</p>
	</section>
</div>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<section class="panel min-w-0" aria-labelledby="recent-matches">
		<div class="panel-head">
			<h2 id="recent-matches" class="font-semibold">Recent matches</h2>
			<a class="link text-sm" href="/matches">All matches</a>
		</div>
		{#if data.matches.length === 0}
			<p class="px-5 py-8 text-sm text-muted">No matches yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="data-table min-w-[28rem]">
					<thead>
						<tr>
							<th>Ended</th>
							<th>Game</th>
							<th>Table</th>
							<th>Winner</th>
						</tr>
					</thead>
					<tbody>
						{#each data.matches as match (match.id)}
							<tr>
								<td class="whitespace-nowrap">
									<a class="link" href="/matches/{match.id}">{utc(match.endedAt)}</a>
								</td>
								<td>{match.gameName}</td>
								<td class="font-mono text-xs">{match.roomCode}</td>
								<td>{match.winner ?? ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="panel min-w-0" aria-labelledby="recent-activity">
		<div class="panel-head">
			<h2 id="recent-activity" class="font-semibold">Admin activity</h2>
			<a class="link text-sm" href="/audit">Audit log</a>
		</div>
		{#if data.audit.length === 0}
			<p class="px-5 py-8 text-sm text-muted">Nothing logged yet.</p>
		{:else}
			<ul class="divide-y divide-line">
				{#each data.audit as row (row.id)}
					{@const byline = [auditActor(row), auditNote(row)].filter(Boolean).join(' · ')}
					<li class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-3 text-sm">
						<span class="font-medium {isAlarming(row.action) ? 'text-danger' : ''}"
							>{auditLabel(row.action)}</span
						>
						{#if row.playerId}
							<a class="link" href="/players/{row.playerId}">{row.playerName ?? row.playerId}</a>
						{:else if row.tournamentId}
							<a class="link" href="/tournaments/{row.tournamentId}">{row.tournamentName}</a>
						{/if}
						<span class="ml-auto text-xs whitespace-nowrap text-muted">{utc(row.createdAt)}</span>
						{#if byline}
							<span class="basis-full text-muted">{byline}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
