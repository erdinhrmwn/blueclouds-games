<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import { statusTag, tournamentStatus } from '#lib/tournament-status.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const values = $derived(form?.values ?? {});
	let game = $state('');
	const picked = $derived(
		data.games.find((g) => g.slug === (game || values.game)) ?? data.games[0]
	);
	let busy = $state(false);
</script>

<svelte:head><title>Tournaments · Backoffice</title></svelte:head>

<PageHeader
	title="Tournaments"
	description="When sign-up closes, the platform hands out the tables by itself; each table starts on its own at the start time."
/>

<div class="grid gap-6 xl:grid-cols-3">
	<section class="panel min-w-0 self-start xl:col-span-2" aria-labelledby="list">
		<div class="panel-head">
			<h2 id="list" class="font-semibold">All tournaments</h2>
		</div>
		{#if data.tournaments.length === 0}
			<p class="px-5 py-10 text-center text-sm text-muted">No tournaments yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="data-table min-w-[40rem]">
					<thead>
						<tr>
							<th>Starts</th>
							<th>Name</th>
							<th>Game</th>
							<th>Players</th>
							<th>Tables</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.tournaments as tournament (tournament.id)}
							{@const status = tournamentStatus(tournament)}
							<tr>
								<td class="whitespace-nowrap">{utc(tournament.startsAt)}</td>
								<td>
									<a class="link font-medium" href="/tournaments/{tournament.id}"
										>{tournament.name}</a
									>
								</td>
								<td>{tournament.gameName}</td>
								<td class="tabular-nums">{tournament.registered}</td>
								<td class="tabular-nums">{tournament.rooms}</td>
								<td><span class={statusTag(status)}>{status.label}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="panel self-start" aria-labelledby="new">
		<div class="panel-head">
			<div>
				<h2 id="new" class="font-semibold">New tournament</h2>
				<p class="text-sm text-muted">Times are in UTC, like everywhere in the backoffice.</p>
			</div>
		</div>
		{#if form?.error}<p class="mx-5 mt-4 text-sm text-danger" role="alert">{form.error}</p>{/if}
		<form
			method="POST"
			action="?/create"
			class="grid gap-4 px-5 py-5 sm:grid-cols-2 xl:grid-cols-1"
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
					value={values.game ?? data.games[0]?.slug}
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
					value={values.name ?? ''}
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
					value={values.startsAt ?? ''}
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
					value={values.playersPerRoom ?? picked?.maxPlayers}
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
					value={values.registrationOpensAt ?? ''}
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
					value={values.registrationClosesAt ?? ''}
				/>
			</div>
			<div class="sm:col-span-2 xl:col-span-1">
				<button class="btn-primary w-full sm:w-auto xl:w-full" disabled={busy}
					>Create tournament</button
				>
			</div>
		</form>
	</section>
</div>
