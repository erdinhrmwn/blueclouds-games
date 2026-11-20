<script lang="ts">
  import type { Tournament } from '#lib/platform.ts'
  import { coins } from '#lib/tournament-formats.ts'
  import {
    FULL,
    SIGN_UP_OPEN,
    type CardAction,
    type OfGame,
    type Status,
  } from '#lib/tournament-status.ts'
  import { when } from '#lib/when.ts'
  import PrizeFee from './PrizeFee.svelte'
  import SignUpBar from './SignUpBar.svelte'
  import TournamentCard from './TournamentCard.svelte'

  /** A tournament open for sign-up: prizes, fee, how full it is, and Join or Leave. */
  interface Props {
    tournament: OfGame<Tournament>
    status: Status
    action: CardAction
    /** The player's coins, and how many they are short of the fee (0 when they can join). */
    coinsHeld: number
    short: number
    ondetail: () => void
    onaction: () => void
  }

  let { tournament, status, action, coinsHeld, short, ondetail, onaction }: Props = $props()
</script>

<TournamentCard
  name={tournament.name}
  game={tournament.game}
  format={tournament.format}
  highlighted={tournament.joined}
  felt={{ label: status.label, dot: status.dot, startsAt: tournament.startsAt }}
>
  {#snippet meta()}
    <!-- Says when sign-up closes only while it is open, so the line never contradicts the status on the felt. -->
    <span
      >{tournament.playersPerRoom} per table · {status === SIGN_UP_OPEN
        ? `Sign-up closes ${when(tournament.registrationClosesAt)}`
        : 'Sign-up closed'}</span
    >
  {/snippet}

  <div class="mt-3">
    <PrizeFee prizes={tournament.prizes} fee={tournament.fee} />
  </div>
  <div class="mt-auto pt-4">
    <SignUpBar
      registered={tournament.registered}
      minPlayers={tournament.minPlayers}
      maxPlayers={tournament.maxPlayers}
      joined={tournament.joined}
      full={status === FULL}
    />
    {#if short > 0}
      <p class="mt-2 text-xs font-bold text-ember">
        You have {coins(coinsHeld)}, {short.toLocaleString()} short
      </p>
    {/if}
  </div>
  <div class="mt-4 grid grid-cols-2 gap-2.5">
    <button
      class="btn-ghost h-11 rounded-xl"
      onclick={ondetail}
      aria-label="Details of {tournament.name}">Detail</button
    >
    <button
      class="{action.style} h-11 rounded-xl"
      onclick={onaction}
      disabled={action.disabled}
      aria-label="{tournament.joined ? 'Leave' : 'Join'} {tournament.name}"
    >
      {action.label}
    </button>
  </div>
</TournamentCard>
