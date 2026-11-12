<script lang="ts">
	import {
		fetchTournaments,
		joinTournament,
		leaveTournament,
		type Tournament,
		type TournamentTable
	} from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { enterTable } from '#lib/tables.ts';

	/** A game's tournaments: the player's own table first, then the ones open for sign-up. Hidden when there are none. */
	let { game }: { game: string } = $props();

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

	// Reload once the player has a name: a brand-new visitor has no account to sign up with yet.
	$effect(() => {
		if (player.ready && player.name) void load();
	});

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

	const when = (iso: string) =>
		new Intl.DateTimeFormat(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
</script>

{#if tables.length || open.length}
	<section class="mt-16" aria-labelledby="tournaments-title">
		<h2 id="tournaments-title" class="font-display text-2xl font-bold">Tournaments</h2>
		<ul class="mt-4 divide-y divide-paper/10 rounded-xl border border-paper/15 bg-[#1b1611]">
			{#each tables as t (t.code)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{t.tournament.name}</span>
						<span class="block text-sm text-paper/75"
							>Starts {when(t.tournament.startsAt)}. Your table is
							<span class="font-mono tracking-[0.15em] text-brass">{t.code}</span>.</span
						>
					</span>
					<button class="btn-brass shrink-0" onclick={() => (error = enterTable(game, t.code))}
						>Go to your table</button
					>
				</li>
			{/each}
			{#each open as t (t.id)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{t.name}</span>
						<span class="block text-sm text-paper/75">
							Starts {when(t.startsAt)} · {t.registered} signed up · sign-up closes {when(
								t.registrationClosesAt
							)}
						</span>
						{#if t.joined}<span class="block text-sm text-brass"
								>You're in. Your table is picked when sign-up closes.</span
							>{/if}
					</span>
					<button
						class="btn-ghost shrink-0"
						onclick={() => toggle(t)}
						disabled={busy === t.id}
						aria-label="{t.joined ? 'Leave' : 'Join'} {t.name}"
					>
						{busy === t.id ? 'Saving…' : t.joined ? 'Leave' : 'Join'}
					</button>
				</li>
			{/each}
		</ul>
		{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}
	</section>
{/if}
