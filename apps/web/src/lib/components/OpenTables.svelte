<script lang="ts">
	import { gameBySlug } from '#lib/games/catalog.ts';
	import { RoomList, type OpenTable } from '#lib/rooms.svelte.ts';
	import { enterTable } from '#lib/tables.ts';
	import { onMount } from 'svelte';

	/**
	 * The public tables of every game in `games`, refreshed every few seconds. `game` shows only that game's tables;
	 * `counts` reports how many tables each game has, whatever is shown.
	 */
	let {
		games,
		game = null,
		counts = $bindable({})
	}: {
		games: string[];
		game?: string | null;
		counts?: Record<string, number>;
	} = $props();

	let list = $state<RoomList | null>(null);

	type Status = { label: string; tone: string; open: boolean; rank: number };

	const AVAILABLE: Status = {
		label: 'Available',
		tone: 'bg-wind/50 text-paper',
		open: true,
		rank: 0
	};
	const PLAYING: Status = {
		label: 'Playing',
		tone: 'bg-paper/12 text-paper',
		open: false,
		rank: 1
	};
	const FULL: Status = { label: 'Full', tone: 'bg-ember/15 text-ember', open: false, rank: 2 };
	const FINISHED: Status = {
		label: 'Finished',
		tone: 'bg-paper/12 text-paper/70',
		open: false,
		rank: 3
	};

	function statusOf(table: OpenTable): Status {
		if (table.phase === 'playing') {
			return PLAYING;
		}

		if (table.phase === 'finished') {
			return FINISHED;
		}

		if (table.players >= table.maxPlayers) {
			return FULL;
		}

		return AVAILABLE;
	}

	/** Tables you can sit at first; the sort is stable, so each group keeps the server's order. */
	const shown = $derived.by(() => {
		const rooms = list?.rooms ?? [];
		const picked = game ? rooms.filter((table) => table.game === game) : rooms;

		return picked
			.map((table) => ({ table, status: statusOf(table) }))
			.sort((first, second) => first.status.rank - second.status.rank);
	});

	const gameName = $derived(game ? (gameBySlug(game)?.name ?? '') : '');

	onMount(() => {
		const rooms = new RoomList(games);
		list = rooms;
		return () => rooms.dispose();
	});

	$effect(() => {
		const perGame: Record<string, number> = {};

		for (const table of list?.rooms ?? []) {
			perGame[table.game] = (perGame[table.game] ?? 0) + 1;
		}

		counts = perGame;
	});
</script>

{#if !list || list.status === 'loading'}
	<p class="text-sm text-paper/70" aria-live="polite">Looking for tables…</p>
{:else if list.status === 'error'}
	<p class="text-sm text-paper/70">
		Could not load the tables. You can still join a friend’s table with its code or invite link.
	</p>
{:else if shown.length === 0}
	<p class="rounded-xl border border-dashed border-paper/20 p-6 text-sm text-paper/70">
		No public {gameName} tables right now. Open one and invite friends.
	</p>
{:else}
	<!-- A table of tables: game, name, code, seats, status, Join. Phones fold the code and status under the name. -->
	<div class="overflow-hidden rounded-2xl border border-paper/10 bg-panel">
		<table class="w-full text-left text-sm">
			<thead class="border-b border-paper/10 text-xs text-paper/55">
				<tr>
					<th scope="col" class="w-px py-3 pl-4 sm:pl-5"><span class="sr-only">Game</span></th>
					<th scope="col" class="px-4 py-3 font-semibold">Table</th>
					<th scope="col" class="px-4 py-3 font-semibold max-sm:hidden">Code</th>
					<th scope="col" class="px-4 py-3 font-semibold max-sm:hidden">Seats</th>
					<th scope="col" class="px-4 py-3 font-semibold max-sm:hidden">Status</th>
					<th scope="col" class="px-4 py-3 sm:pr-5"><span class="sr-only">Join</span></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-paper/8">
				{#each shown as { table, status } (`${table.game}:${table.code}`)}
					{@const tableGame = gameBySlug(table.game)}
					<tr>
						<td class="py-2.5 pl-4 sm:pl-5">
							<span
								class="card-back {tableGame?.back ?? ''} block h-9 w-[25px] -rotate-6"
								aria-hidden="true"
							></span>
						</td>
						<td class="w-full max-w-0 px-4 py-2.5 sm:w-[38%]">
							<span class="block truncate text-[14.5px] font-semibold text-paper"
								>{table.name ?? (table.host ? `${table.host}’s table` : 'Table')}</span
							>
							<span class="mt-0.5 block truncate text-[12.5px] text-paper/55">
								{tableGame?.name ?? table.game}
								<span class="sm:hidden">
									·
									<span class="font-semibold tracking-[0.12em] text-brass">{table.code}</span>
								</span>
							</span>
							<span class="mt-1.5 flex items-center gap-2 sm:hidden">
								<span class="rounded-full px-2 py-px text-[11.5px] font-semibold {status.tone}"
									>{status.label}</span
								>
								<span class="text-xs font-medium text-paper/70 tabular-nums"
									>{table.players}/{table.maxPlayers}</span
								>
							</span>
						</td>
						<td
							class="px-4 py-2.5 text-[12.5px] font-semibold tracking-[0.15em] text-brass max-sm:hidden"
						>
							{table.code}
						</td>
						<td class="px-4 py-2.5 max-sm:hidden">
							<span
								class="flex items-center gap-1"
								role="img"
								aria-label="{table.players} of {table.maxPlayers} seats taken"
							>
								{#each Array(table.maxPlayers) as _, seat (seat)}
									<span
										class="size-[7px] rounded-full {seat < table.players
											? 'bg-paper/85'
											: 'border border-paper/35'}"
									></span>
								{/each}
								<span class="ml-1 text-xs font-medium text-paper/70 tabular-nums"
									>{table.players}/{table.maxPlayers}</span
								>
							</span>
						</td>
						<td class="px-4 py-2.5 max-sm:hidden">
							<span
								class="rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap {status.tone}"
								>{status.label}</span
							>
						</td>
						<td class="px-4 py-2.5 text-right sm:pr-5">
							<button
								class="h-9 w-[4.75rem] shrink-0 rounded-[10px] text-[13px] font-semibold {status.open
									? 'bg-brass text-ink hover:brightness-110'
									: 'border border-paper/15 text-paper/40'}"
								onclick={() => enterTable(table.game, table.code)}
								disabled={!status.open}
								aria-label="Join table {table.code}"
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
