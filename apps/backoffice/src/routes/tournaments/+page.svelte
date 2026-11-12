<script lang="ts">
	import { enhance } from '$app/forms';
	import { utc } from '#lib/format.ts';
	import { tournamentStatus } from '#lib/tournament-status.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const v = $derived(form?.values ?? {});
	let game = $state('');
	const picked = $derived(data.games.find((g) => g.slug === (game || v.game)) ?? data.games[0]);
	let busy = $state(false);
</script>

<svelte:head><title>Tournaments · Backoffice</title></svelte:head>

<h1 class="text-2xl font-semibold">Tournaments</h1>
<p class="mt-1 text-sm text-muted">
	When sign-up closes, the platform hands out the tables by itself; each table starts on its own at
	the start time.
</p>

{#if data.tournaments.length === 0}
	<p class="mt-6 text-muted">No tournaments yet.</p>
{:else}
	<div class="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
		<table class="w-full min-w-[40rem] text-left text-sm">
			<thead class="border-b border-line text-muted">
				<tr>
					<th class="px-3 py-2 font-medium">Starts</th>
					<th class="px-3 py-2 font-medium">Name</th>
					<th class="px-3 py-2 font-medium">Game</th>
					<th class="px-3 py-2 font-medium">Players</th>
					<th class="px-3 py-2 font-medium">Tables</th>
					<th class="px-3 py-2 font-medium">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tournaments as t (t.id)}
					{@const s = tournamentStatus(t)}
					<tr class="border-b border-line last:border-0 hover:bg-page">
						<td class="px-3 py-2 whitespace-nowrap">{utc(t.startsAt)}</td>
						<td class="px-3 py-2">
							<a
								class="font-medium underline decoration-line underline-offset-2 hover:decoration-ink"
								href="/tournaments/{t.id}">{t.name}</a
							>
						</td>
						<td class="px-3 py-2">{t.gameName}</td>
						<td class="px-3 py-2 tabular-nums">{t.registered}</td>
						<td class="px-3 py-2 tabular-nums">{t.rooms}</td>
						<td class="px-3 py-2 {s.bad ? 'font-medium text-danger' : ''}">{s.label}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<section class="mt-8 max-w-2xl rounded-lg border border-line bg-surface p-4" aria-labelledby="new">
	<h2 id="new" class="font-semibold">New tournament</h2>
	<p class="mt-1 text-sm text-muted">Times are in UTC, like everywhere in the backoffice.</p>
	{#if form?.error}<p class="mt-2 text-sm text-danger" role="alert">{form.error}</p>{/if}
	<form
		method="POST"
		action="?/create"
		class="mt-3 grid gap-3 sm:grid-cols-2"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<div>
			<label class="label" for="game">Game</label>
			<select
				class="field"
				id="game"
				name="game"
				value={v.game ?? data.games[0]?.slug}
				onchange={(e) => (game = e.currentTarget.value)}
			>
				{#each data.games as g (g.slug)}<option value={g.slug}>{g.name}</option>{/each}
			</select>
		</div>
		<div>
			<label class="label" for="name">Name</label>
			<input
				class="field"
				id="name"
				name="name"
				value={v.name ?? ''}
				maxlength="80"
				required
				placeholder="Friday Cup"
			/>
		</div>
		<div>
			<label class="label" for="startsAt">Starts (UTC)</label>
			<input
				class="field"
				id="startsAt"
				name="startsAt"
				type="datetime-local"
				value={v.startsAt ?? ''}
				required
			/>
		</div>
		<div>
			<label class="label" for="playersPerRoom">Players per table</label>
			<input
				class="field"
				id="playersPerRoom"
				name="playersPerRoom"
				type="number"
				min={picked?.minPlayers}
				max={picked?.maxPlayers}
				value={v.playersPerRoom ?? picked?.maxPlayers}
				required
			/>
		</div>
		<div>
			<label class="label" for="registrationOpensAt">Sign-up opens (UTC, empty = now)</label>
			<input
				class="field"
				id="registrationOpensAt"
				name="registrationOpensAt"
				type="datetime-local"
				value={v.registrationOpensAt ?? ''}
			/>
		</div>
		<div>
			<label class="label" for="registrationClosesAt"
				>Sign-up closes (UTC, empty = 10 min before start)</label
			>
			<input
				class="field"
				id="registrationClosesAt"
				name="registrationClosesAt"
				type="datetime-local"
				value={v.registrationClosesAt ?? ''}
			/>
		</div>
		<div class="sm:col-span-2">
			<button class="btn-primary" disabled={busy}>Create tournament</button>
		</div>
	</form>
</section>
