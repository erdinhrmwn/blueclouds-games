<script lang="ts">
  import type { LiveTournament } from '#lib/platform.ts'
  import { coins } from '#lib/tournament-formats.ts'
  import type { OfGame } from '#lib/tournament-status.ts'
  import { day } from '#lib/when.ts'
  import TournamentCard from './TournamentCard.svelte'

  /** A tournament that finished in the last day: its winners and what each won. */
  interface Props {
    tournament: OfGame<LiveTournament>
    onresults: () => void
  }

  let { tournament, onresults }: Props = $props()

  const prizeFor = (place: number) => tournament.prizes.find((prize) => prize.place === place)
</script>

<TournamentCard
  name={tournament.name}
  game={tournament.game}
  format={tournament.format}
  felt={{
    label: 'Finished',
    dot: 'bg-brass',
    startsAt: tournament.endedAt ?? tournament.roundStartsAt,
    headline: day(tournament.endedAt ?? tournament.startsAt),
  }}
>
  {#snippet meta()}
    {tournament.players} players · {tournament.round}
    {tournament.round === 1 ? 'stage' : 'stages'}
  {/snippet}

  <ol class="mt-3 space-y-2 text-sm" aria-label="Winners">
    {#each tournament.top as standing (standing.playerId)}
      {@const first = standing.place === 1}
      <li class="flex items-center gap-3">
        <span
          class="grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold {first
            ? 'bg-brass text-ink'
            : 'bg-paper/15 text-paper'}">{standing.place}</span
        >
        <span class="min-w-0 flex-1 truncate font-semibold">{standing.name}</span>
        <span class="text-xs font-bold tabular-nums {first ? 'text-brass' : 'text-paper/80'}"
          >{coins(prizeFor(standing.place)?.coins ?? 0)}</span
        >
      </li>
    {/each}
  </ol>
  <div class="mt-auto pt-4">
    <button
      class="btn-ghost h-11 w-full rounded-xl"
      onclick={onresults}
      aria-label="Results of {tournament.name}">Results</button
    >
  </div>
</TournamentCard>
