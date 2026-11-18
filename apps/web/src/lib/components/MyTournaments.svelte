<script lang="ts">
  import { gameBySlug } from '#lib/games/catalog.ts'
  import type { MyTournament, TournamentRecord } from '#lib/server/platform/history.ts'
  import { FORMATS, ordinal } from '#lib/tournament-formats.ts'
  import { day } from '#lib/when.ts'

  /**
   * The profile's tournaments: the record over all of them, then the latest ones with where the player finished
   * and what that place wins. Payout status never shows here (Erdin, 2026-11-14).
   */
  let {
    tournaments,
    record,
    mounted,
  }: { tournaments: MyTournament[]; record: TournamentRecord; mounted: boolean } = $props()

  const tiles = $derived([
    { label: 'Played', value: String(record.played) },
    { label: 'Top 3', value: String(record.podiums) },
    { label: 'Best place', value: record.bestPlace === null ? '–' : ordinal(record.bestPlace) },
    { label: 'Prize coins', value: record.prizeCoins.toLocaleString() },
  ])

  /** Live and finished ones open their bracket; the others open the game's lobby, where sign-up lives. */
  const linkOf = (tournament: MyTournament) =>
    tournament.status === 'live' || tournament.status === 'finished'
      ? `/${tournament.game}/tournaments/${tournament.id}`
      : `/${tournament.game}`

  /** The badge on the right: where they stand, or why they don't. */
  function badgeOf(tournament: MyTournament): { text: string; strong: boolean } {
    if (tournament.entry === 'disqualified') {
      return { text: 'Disqualified', strong: false }
    }

    if (tournament.status === 'cancelled') {
      return { text: 'Cancelled', strong: false }
    }

    if (tournament.place !== null) {
      const text = `${ordinal(tournament.place)} of ${tournament.players}`
      return { text, strong: tournament.place === 1 }
    }

    if (tournament.entry === 'withdrawn') {
      return { text: 'Withdrawn', strong: false }
    }

    if (tournament.status === 'live') {
      const stage = tournament.stage ? ` · Stage ${tournament.stage}` : ''
      return { text: `Live${stage}`, strong: true }
    }

    if (tournament.status === 'upcoming') {
      return { text: 'Signed up', strong: false }
    }

    return { text: 'Finished', strong: false }
  }

  /** "Arena · Bust 31 · Sat, 14 Nov", then what the place wins, if anything. */
  function detailOf(tournament: MyTournament): string {
    const parts = [
      tournament.format ? FORMATS[tournament.format].label : null,
      gameBySlug(tournament.game)?.name ?? tournament.game,
      mounted ? day(tournament.startsAt) : null,
    ]

    return parts.filter((part) => part !== null).join(' · ')
  }

  function prizeOf(tournament: MyTournament): string | null {
    const prize = tournament.prize
    if (!prize) {
      return null
    }

    const parts = [prize.coins > 0 ? `${prize.coins.toLocaleString()} coins` : null, prize.extra]

    return parts.filter((part) => part !== null).join(' · ') || null
  }
</script>

<!-- The profile's Tournaments tab names the section, so its heading is for screen readers only. -->
<section class="mt-6" aria-labelledby="tournaments-title">
  <h2 id="tournaments-title" class="sr-only">Tournaments</h2>

  <!-- A record of zeros says nothing: it shows once a tournament has finished with them in it. -->
  {#if record.played > 0}
    <dl class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#each tiles as tile (tile.label)}
        <div class="flex flex-col-reverse rounded-2xl border border-paper/10 bg-panel px-4 py-3.5">
          <dt class="mt-1 text-xs text-paper/55">{tile.label}</dt>
          <dd class="font-display text-2xl font-black tabular-nums">{tile.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if tournaments.length === 0}
    <p class="rounded-2xl border border-dashed border-paper/20 p-6 text-sm text-paper/65">
      No tournaments yet. Sign up from a game’s lobby.
    </p>
  {:else}
    <ul class="space-y-2">
      {#each tournaments as tournament (tournament.id)}
        {@const game = gameBySlug(tournament.game)}
        {@const badge = badgeOf(tournament)}
        {@const prize = prizeOf(tournament)}
        <li>
          <a
            href={linkOf(tournament)}
            class="flex items-center gap-4 rounded-xl border border-paper/10 bg-panel px-4 py-3 hover:border-paper/30 focus-visible:outline-2 focus-visible:outline-brass"
          >
            {#if game}
              <game.Emblem small class="size-9 shrink-0" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{tournament.name}</span>
              <span class="block text-xs text-paper/55">{detailOf(tournament)}</span>
              {#if prize}
                <span class="mt-0.5 block text-xs font-semibold text-brass">Won {prize}</span>
              {/if}
            </span>
            <span
              class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums {badge.strong
                ? 'bg-brass text-ink'
                : 'bg-black/35 text-paper/85'}">{badge.text}</span
            >
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
