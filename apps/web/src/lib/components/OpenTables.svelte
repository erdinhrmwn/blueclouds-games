<script lang="ts">
	import { RoomList } from '#lib/rooms.svelte.ts';
	import { enterTable } from '#lib/tables.ts';
	import { onMount } from 'svelte';

	/** A game's public tables, refreshed every few seconds. `count` reports how many there are. */
	let { game, count = $bindable(0) }: { game: string; count?: number } = $props();

	let list = $state<RoomList | null>(null);

	type Status = { label: string; tone: string; open: boolean };

	const PLAYING: Status = { label: 'Playing', tone: 'bg-paper/12 text-paper', open: false };
	const FINISHED: Status = { label: 'Finished', tone: 'bg-paper/12 text-paper/70', open: false };
	const FULL: Status = { label: 'Full', tone: 'bg-ember/15 text-ember', open: false };
	const AVAILABLE: Status = { label: 'Available', tone: 'bg-wind/50 text-paper', open: true };

	function statusOf(phase: string, players: number, maxPlayers: number): Status {
		if (phase === 'playing') {
			return PLAYING;
		}
		if (phase === 'finished') {
			return FINISHED;
		}
		if (players >= maxPlayers) {
			return FULL;
		}

		return AVAILABLE;
	}

	onMount(() => {
		const rooms = new RoomList(game);
		list = rooms;
		return () => rooms.dispose();
	});

	$effect(() => {
		count = list?.rooms.length ?? 0;
	});
</script>

{#if !list || list.status === 'loading'}
	<p class="text-sm text-paper/70" aria-live="polite">Looking for tables…</p>
{:else if list.status === 'error'}
	<p class="text-sm text-paper/70">
		Could not load the tables. You can still join a friend’s table with its code or invite link.
	</p>
{:else if list.rooms.length === 0}
	<p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
		No public tables right now. Open one and invite friends.
	</p>
{:else}
	<!-- A table of tables: name, code, seats, status, Join. Phones fold the code and status under the name. -->
	<div class="overflow-hidden rounded-2xl border border-paper/10 bg-panel">
		<table class="w-full text-left text-sm">
			<thead class="border-b border-paper/10 text-xs text-paper/55">
				<tr>
					<th scope="col" class="px-4 py-3 font-semibold sm:px-5">Table</th>
					<th scope="col" class="px-4 py-3 font-semibold max-sm:hidden">Code</th>
					<th scope="col" class="px-4 py-3 font-semibold">Seats</th>
					<th scope="col" class="px-4 py-3 font-semibold max-sm:hidden">Status</th>
					<th scope="col" class="px-4 py-3 sm:pr-5"><span class="sr-only">Join</span></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-paper/8">
				{#each list.rooms as r (r.code)}
					{@const status = statusOf(r.phase, r.players, r.maxPlayers)}
					<tr>
						<td class="w-full max-w-0 px-4 py-3.5 sm:w-[40%] sm:px-5">
							<span class="block truncate font-medium text-paper"
								>{r.name ?? (r.host ? `${r.host}’s table` : 'Table')}</span
							>
							<span class="mt-1 flex flex-col items-start gap-1.5 sm:hidden">
								<span class="font-semibold text-brass">{r.code}</span>
								<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold {status.tone}"
									>{status.label}</span
								>
							</span>
						</td>
						<td class="px-4 py-3.5 font-semibold text-brass max-sm:hidden">{r.code}</td>
						<td class="px-4 py-3.5">
							<span
								class="flex items-center gap-1"
								role="img"
								aria-label="{r.players} of {r.maxPlayers} seats taken"
							>
								{#each Array(r.maxPlayers) as _, seat (seat)}
									<span
										class="size-2 rounded-full max-sm:hidden {seat < r.players
											? 'bg-paper/85'
											: 'border border-paper/35'}"
									></span>
								{/each}
								<span class="text-xs text-paper/60 tabular-nums sm:ml-1"
									>{r.players}/{r.maxPlayers}</span
								>
							</span>
						</td>
						<td class="px-4 py-3.5 max-sm:hidden">
							<span
								class="rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap {status.tone}"
								>{status.label}</span
							>
						</td>
						<td class="px-4 py-3.5 text-right sm:pr-5">
							<button
								class="h-9 shrink-0 rounded-lg px-5 text-sm font-semibold {status.open
									? 'bg-brass text-ink hover:brightness-110'
									: 'border border-paper/15 text-paper/40'}"
								onclick={() => enterTable(game, r.code)}
								disabled={!status.open}
								aria-label="Join table {r.code}"
							>
								Join
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
