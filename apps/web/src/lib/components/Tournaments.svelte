<script lang="ts">
	import { ask } from '#lib/confirm.svelte.ts';
	import {
		fetchTournaments,
		joinTournament,
		leaveTournament,
		type Tournament,
		type TournamentTable
	} from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { enterTable } from '#lib/tables.ts';
	import { when } from '#lib/when.ts';

	/** A game's tournaments: the player's own table first, then the ones open for sign-up. `count` reports how many. */
	let { game, count = $bindable(0) }: { game: string; count?: number } = $props();

	let tables = $state<TournamentTable[]>([]);
	let open = $state<Tournament[]>([]);
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		try {
			const result = await fetchTournaments(game);
			open = result.tournaments;
			tables = result.tables;
		} catch {
			// Tournaments are extra: the rest of the page works without them.
		}
	}

	$effect(() => {
		count = tables.length + open.length;
	});

	// Reload once the player has a name: a brand-new visitor has no account to sign up with yet.
	$effect(() => {
		if (player.ready && player.name) void load();
	});

	/** Gives up a seat already handed out. The platform keeps the player out of this tournament from then on. */
	async function withdraw(table: TournamentTable) {
		const { id, name } = table.tournament;
		const sure = await ask({
			title: `Withdraw from ${name}?`,
			body: 'Your seat is given up and you can’t come back to this tournament.',
			action: 'Withdraw'
		});
		if (!sure) {
			return;
		}

		busy = id;
		error = null;

		try {
			await leaveTournament(id);
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		} finally {
			busy = null;
		}
	}

	async function toggle(tournament: Tournament) {
		busy = tournament.id;
		error = null;

		try {
			if (tournament.joined) {
				await leaveTournament(tournament.id);
			} else {
				await joinTournament(tournament.id);
			}

			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		} finally {
			busy = null;
		}
	}
</script>

{#if tables.length === 0 && open.length === 0}
	<p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
		No tournaments open for sign-up right now.
	</p>
{:else}
	<ul class="space-y-3">
		{#each tables as t (t.code)}
			<li class="rounded-2xl border-[1.5px] border-brass bg-panel p-5">
				<div class="flex items-start justify-between gap-3">
					<h3 class="font-display text-lg font-bold text-paper">{t.tournament.name}</h3>
					<span class="shrink-0 rounded-full bg-brass px-2.5 py-0.5 text-xs font-bold text-ink"
						>You’re in</span
					>
				</div>
				<p class="mt-1 text-sm font-semibold text-paper/85">Starts {when(t.tournament.startsAt)}</p>
				<p class="mt-0.5 text-sm text-paper/55">
					Your table is <span class="font-semibold text-brass">{t.code}</span>
				</p>
				<div class="mt-4 flex flex-wrap justify-end gap-2">
					{#if !t.started}
						<button
							class="btn-ghost"
							onclick={() => withdraw(t)}
							disabled={busy === t.tournament.id}
							aria-label="Withdraw from {t.tournament.name}"
						>
							{busy === t.tournament.id ? 'Saving…' : 'Withdraw'}
						</button>
					{/if}
					<button class="btn-brass" onclick={() => (error = enterTable(game, t.code))}
						>Go to your table</button
					>
				</div>
			</li>
		{/each}
		{#each open as t (t.id)}
			<li
				class="rounded-2xl bg-panel p-5 {t.joined
					? 'border-[1.5px] border-brass'
					: 'border border-paper/10'}"
			>
				<div class="flex items-start justify-between gap-3">
					<h3 class="font-display text-lg font-bold text-paper">{t.name}</h3>
					{#if t.joined}
						<span class="shrink-0 rounded-full bg-brass px-2.5 py-0.5 text-xs font-bold text-ink"
							>You’re in</span
						>
					{/if}
				</div>
				<p class="mt-1 text-sm font-semibold text-paper/85">Starts {when(t.startsAt)}</p>
				<p class="mt-0.5 text-sm text-paper/55">Sign-up closes {when(t.registrationClosesAt)}</p>
				<div class="mt-4 flex items-center justify-between gap-3">
					<span class="text-xs text-paper/55 tabular-nums">{t.registered} signed up</span>
					<button
						class={t.joined ? 'btn-ghost' : 'btn-brass'}
						onclick={() => toggle(t)}
						disabled={busy === t.id}
						aria-label="{t.joined ? 'Leave' : 'Join'} {t.name}"
					>
						{busy === t.id ? 'Saving…' : t.joined ? 'Leave' : 'Join'}
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}
