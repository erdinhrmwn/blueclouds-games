<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { utc } from '#lib/format.ts';
	import {
		FEE_MAX,
		MAX_PLAYERS_LIMIT,
		PRIZE_PLACES_MAX,
		ROUNDS_DEFAULT,
		ROUNDS_MAX,
		TOURNAMENT_TEXT_MAX
	} from '#lib/limits.ts';
	import { statusTag, TOURNAMENT_FORMATS, tournamentStatus } from '#lib/tournament-status.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	/**
	 * What a refused form sent back. The fields take it as defaultValue, not value: the form's attributes update
	 * together, so with value, typing in one field (players per table) wiped what was already typed in the others.
	 */
	const values = $derived(form?.values ?? {});
	let game = $state('');
	const picked = $derived(
		data.games.find((g) => g.slug === (game || values.game)) ?? data.games[0]
	);
	let busy = $state(false);
	/** The picked format: a knockout has no round count, it plays until one player is left. */
	let format = $state('');
	/** Players per table as typed (undefined until typed): the most players can't be fewer than one table. */
	let perTable = $state<number | null | undefined>(undefined);
	const shownPerTable = $derived(
		perTable === undefined ? Number(values.playersPerRoom ?? picked?.maxPlayers) : perTable
	);
	const fewestMost = $derived(shownPerTable || picked?.maxPlayers);

	/** Paid places, 1st first; three to start with, as most tournaments pay a podium. */
	const STARTING_PLACES = 3;
	type PrizeRow = { key: number; coins: string; extra: string };
	let nextKey = 0;
	const newRow = (coins = '', extra = ''): PrizeRow => {
		nextKey += 1;
		return { key: nextKey, coins, extra };
	};
	let prizes = $state<PrizeRow[]>(Array.from({ length: STARTING_PLACES }, () => newRow()));

	// A refused form comes back with what was typed.
	$effect(() => {
		if (form?.prizes) {
			prizes = form.prizes.map((row) => newRow(row.coins, row.extra));
		}
	});

	function addPlace() {
		prizes.push(newRow());
	}

	function removePlace(index: number) {
		prizes.splice(index, 1);
	}

	const PLACE_SUFFIX = ['st', 'nd', 'rd'];
	/** "1st", "2nd", "3rd", "4th"… */
	const placeName = (index: number) => `${index + 1}${PLACE_SUFFIX[index] ?? 'th'}`;
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
								<td class="tabular-nums">
									{tournament.registered}{#if tournament.maxPlayers !== null}
										/ {tournament.maxPlayers}{/if}
								</td>
								<td class="tabular-nums">{tournament.rooms}</td>
								<td><span class={statusTag(status)}>{status.label}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	{#if data.admin?.role !== 'viewer'}
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
						defaultValue={values.name ?? ''}
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
						defaultValue={values.startsAt ?? ''}
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
						bind:value={() => shownPerTable, (typed) => (perTable = typed)}
						required
					/>
				</div>
				<div>
					<label class="label" for="minPlayers">Fewest players (else cancelled)</label>
					<input
						class="field"
						id="minPlayers"
						name="minPlayers"
						type="number"
						min={picked?.minPlayers}
						max={MAX_PLAYERS_LIMIT}
						defaultValue={values.minPlayers ?? ''}
						required
						placeholder="8"
					/>
				</div>
				<div>
					<label class="label" for="maxPlayers">Most players (then sign-up closes)</label>
					<input
						class="field"
						id="maxPlayers"
						name="maxPlayers"
						type="number"
						min={fewestMost}
						max={MAX_PLAYERS_LIMIT}
						defaultValue={values.maxPlayers ?? ''}
						required
						placeholder="36"
					/>
				</div>
				<div>
					<label class="label" for="format">Format</label>
					<select
						class="field"
						id="format"
						name="format"
						value={values.format ?? 'arena'}
						onchange={(e) => (format = e.currentTarget.value)}
					>
						{#each TOURNAMENT_FORMATS as format (format.value)}
							<option value={format.value}>{format.label}: {format.note}</option>
						{/each}
					</select>
				</div>
				{#if (format || values.format || 'arena') !== 'knockout'}
					<div>
						<label class="label" for="rounds">Stages (Arena and Swiss)</label>
						<input
							class="field"
							id="rounds"
							name="rounds"
							type="number"
							min="1"
							max={ROUNDS_MAX}
							step="1"
							defaultValue={values.rounds ?? ROUNDS_DEFAULT}
							required
						/>
					</div>
				{/if}
				<fieldset class="sm:col-span-2 xl:col-span-1">
					<legend class="label">Prizes by place (coins, and an optional extra like a badge)</legend>
					<ol class="space-y-2">
						{#each prizes as prize, index (prize.key)}
							<li class="grid grid-cols-[2.5rem_1fr_1fr_auto] items-center gap-2">
								<span class="text-sm font-semibold text-muted tabular-nums">{placeName(index)}</span
								>
								<input
									class="field"
									name="prizeCoins"
									type="number"
									min="0"
									max={FEE_MAX}
									step="1"
									bind:value={prize.coins}
									placeholder="Coins"
									aria-label="{placeName(index)} place coins"
								/>
								<input
									class="field"
									name="prizeExtra"
									bind:value={prize.extra}
									maxlength={TOURNAMENT_TEXT_MAX.prizeExtra}
									placeholder="Extra"
									aria-label="{placeName(index)} place extra"
								/>
								<button
									type="button"
									class="btn-quiet"
									onclick={() => removePlace(index)}
									aria-label="Remove {placeName(index)} place">Remove</button
								>
							</li>
						{/each}
					</ol>
					{#if prizes.length < PRIZE_PLACES_MAX}
						<button type="button" class="btn-quiet mt-2" onclick={addPlace}>Add a place</button>
					{/if}
				</fieldset>
				<div>
					<label class="label" for="fee">Fee in coins (0 or empty = free)</label>
					<input
						class="field"
						id="fee"
						name="fee"
						type="number"
						min="0"
						max={FEE_MAX}
						step="1"
						defaultValue={values.fee ?? ''}
						placeholder="0"
					/>
				</div>
				<div class="sm:col-span-2 xl:col-span-1">
					<label class="label" for="description">Description</label>
					<textarea
						class="field min-h-24"
						id="description"
						name="description"
						maxlength={TOURNAMENT_TEXT_MAX.description}
						defaultValue={values.description ?? ''}
						placeholder="How it's played and what's at stake."></textarea>
				</div>
				<div>
					<label class="label" for="registrationOpensAt">Sign-up opens (UTC, empty = now)</label>
					<input
						class="field"
						id="registrationOpensAt"
						name="registrationOpensAt"
						type="datetime-local"
						defaultValue={values.registrationOpensAt ?? ''}
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
						defaultValue={values.registrationClosesAt ?? ''}
					/>
				</div>
				<div class="sm:col-span-2 xl:col-span-1">
					<button class="btn-primary w-full sm:w-auto xl:w-full" disabled={busy}
						>Create tournament</button
					>
				</div>
			</form>
		</section>
	{/if}
</div>
