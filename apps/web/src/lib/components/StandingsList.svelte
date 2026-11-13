<script lang="ts">
	import type { Standing } from '#lib/platform.ts';
	import { avatarTone } from '#lib/tournament-formats.ts';

	/**
	 * A tournament's standings as a table: place, player, then points and wins (Arena, Swiss) or how far they got
	 * (Knockout). The viewer's own row is tinted. Long lists show the top and a button for the rest.
	 */
	let {
		standings,
		byPoints,
		round,
		finished,
		myId
	}: {
		standings: Standing[];
		byPoints: boolean;
		/** The latest round; in a knockout, anyone whose last round is below it is out. */
		round: number;
		finished: boolean;
		myId: string | null;
	} = $props();

	const SHOWN_FIRST = 10;
	let showAll = $state(false);
	const shown = $derived(showAll ? standings : standings.slice(0, SHOWN_FIRST));

	/** Gold, silver and bronze for the top three. */
	const MEDALS = ['bg-brass text-ink', 'bg-paper/75 text-ink', 'bg-rim-light text-paper'];

	/** A knockout row: still in, or the round they went out in ("the final" for the last one). */
	function knockoutNote(standing: Standing): string {
		if (standing.place === 1 && finished) {
			return 'Champion';
		}

		if (!finished && standing.lastRound >= round) {
			return 'In';
		}

		if (standing.lastRound >= round) {
			return 'Out in the final';
		}

		return `Out in round ${standing.lastRound}`;
	}
</script>

<table class="w-full text-sm">
	<thead class="text-xs text-paper/50">
		<tr>
			<th scope="col" class="w-8 pb-2 text-left font-medium">#</th>
			<th scope="col" class="pb-2 text-left font-medium">Player</th>
			{#if byPoints}
				<th scope="col" class="pb-2 text-right font-medium">Wins</th>
				<th scope="col" class="pb-2 pl-4 text-right font-medium">Points</th>
			{:else}
				<th scope="col" class="pb-2 text-right font-medium"><span class="sr-only">Status</span></th>
			{/if}
		</tr>
	</thead>
	<tbody>
		{#each shown as standing (standing.playerId)}
			{@const mine = standing.playerId === myId}
			<tr class="border-t border-paper/8 {mine ? 'bg-brass/12' : ''}">
				<td class="py-2">
					{#if standing.place <= MEDALS.length}
						<span
							class="grid size-5 place-items-center rounded-full text-[11px] font-extrabold {MEDALS[
								standing.place - 1
							]}">{standing.place}</span
						>
					{:else}
						<span class="pl-1 font-semibold text-paper/60 tabular-nums">{standing.place}</span>
					{/if}
				</td>
				<td class="py-2">
					<span class="flex min-w-0 items-center gap-2">
						<span
							class="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-paper {avatarTone(
								standing.name
							)}"
							aria-hidden="true">{standing.name.charAt(0).toUpperCase()}</span
						>
						<span class="truncate {mine ? 'font-bold' : ''}">{standing.name}</span>
						{#if mine}<span class="shrink-0 text-xs text-brass">you</span>{/if}
						{#if standing.bot}
							<span
								class="shrink-0 rounded bg-paper/10 px-1.5 text-[10px] font-semibold text-paper/70"
								>bot</span
							>
						{/if}
					</span>
				</td>
				{#if byPoints}
					<td class="py-2 text-right text-paper/80 tabular-nums">{standing.wins}</td>
					<td class="py-2 pl-4 text-right font-bold tabular-nums">{standing.points}</td>
				{:else}
					<td class="py-2 text-right text-xs text-paper/60">{knockoutNote(standing)}</td>
				{/if}
			</tr>
		{/each}
	</tbody>
</table>
{#if standings.length > SHOWN_FIRST}
	<button
		class="mt-2 w-full py-1 text-center text-sm font-semibold text-brass hover:underline"
		onclick={() => (showAll = !showAll)}
	>
		{showAll ? 'Show fewer' : `Show all ${standings.length}`}
	</button>
{/if}
