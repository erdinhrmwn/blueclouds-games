<script lang="ts">
  import type { Player } from 'contracts/rooms/cloudburst'

  /** The round's score sheet, in the ring's place until the next deal: who gained what, and where each stands. */
  interface Props {
    outName: string
    /** Fewest points first. */
    standings: Player[]
    gained: Record<string, number>
    burstAt: number
    tie: boolean
  }

  let { outName, standings, gained, burstAt, tie }: Props = $props()
</script>

<div
  class="summary w-full max-w-52 rounded-xl px-3 py-2.5 wide:max-w-[30rem] wide:px-5 wide:py-4"
  role="status"
>
  <p class="text-center font-display text-base leading-tight font-bold wide:text-xl">
    {outName} went out
  </p>
  <ol
    class="mt-2 grid gap-y-0.5 text-xs tabular-nums wide:mt-3 wide:grid-cols-2 wide:gap-x-8 wide:gap-y-1 wide:text-sm"
  >
    {#each standings as player (player.id)}
      {@const close = player.points >= burstAt - 2}
      <li class="flex items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate text-paper/85">{player.name}</span>
        <span class="text-paper/55">+{gained[player.id] ?? 0}</span>
        <span class="w-11 text-right font-semibold {close ? 'text-ember' : 'text-paper'}"
          >{player.points}/{burstAt}</span
        >
      </li>
    {/each}
  </ol>
  {#if tie}<p class="mt-2 text-center text-xs text-brass">
      Tie for fewest points: one more round.
    </p>{/if}
</div>

<style>
  .summary {
    background: rgb(10 8 6 / 0.72);
    box-shadow: inset 0 0 0 1px rgb(210 165 76 / 0.3);
  }
</style>
