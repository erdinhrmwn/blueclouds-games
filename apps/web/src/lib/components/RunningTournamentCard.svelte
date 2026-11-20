<script lang="ts">
  import type { LiveTournament } from '#lib/platform.ts'
  import { myLine, rowNote, stageLabel, stageLine, type OfGame } from '#lib/tournament-status.ts'
  import TournamentCard from './TournamentCard.svelte'

  /** A tournament being played: the top of its standings, and the player's way back to their table. */
  interface Props {
    tournament: OfGame<LiveTournament>
    now: number
    onstandings: () => void
    /** Opens the player's table, by its code. */
    ontable: (code: string) => void
  }

  let { tournament, now, onstandings, ontable }: Props = $props()

  const line = $derived(myLine(tournament))
  const table = $derived(tournament.table && !tournament.table.closed ? tournament.table : null)
</script>

<TournamentCard
  name={tournament.name}
  game={tournament.game}
  format={tournament.format}
  highlighted={tournament.table !== null}
  felt={{
    label: stageLabel(tournament),
    dot: 'bg-paper',
    startsAt: tournament.roundStartsAt,
    headline: stageLine(tournament, now),
  }}
>
  {#snippet meta()}
    {#if line}
      <span class="font-bold text-brass">{line}</span>
    {:else}
      <span>{tournament.players} players</span>
    {/if}
  {/snippet}

  {#if tournament.top.length > 0}
    <ol class="mt-3 space-y-1 text-sm" aria-label="Top of the standings">
      {#each tournament.top as standing (standing.playerId)}
        {@const mine = standing.playerId === tournament.me?.playerId}
        <li class="flex items-center gap-3 rounded-md px-2 py-1 {mine ? 'bg-brass/12' : ''}">
          <span class="w-4 font-extrabold text-brass tabular-nums">{standing.place}</span>
          <span class="min-w-0 flex-1 truncate {mine ? 'font-bold' : ''}"
            >{standing.name}{mine ? ' (you)' : ''}</span
          >
          <span class="text-xs text-paper/70 tabular-nums">{rowNote(tournament, standing)}</span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="mt-3 text-xs text-paper/55">Standings show once the first tables finish.</p>
  {/if}
  <div class="mt-auto grid gap-2.5 pt-4 {table ? 'grid-cols-2' : ''}">
    <button
      class="btn-ghost h-11 rounded-xl"
      onclick={onstandings}
      aria-label="Standings of {tournament.name}">Standings</button
    >
    {#if table}
      <button class="btn-brass h-11 rounded-xl" onclick={() => ontable(table.code)}
        >Go to table</button
      >
    {/if}
  </div>
</TournamentCard>
