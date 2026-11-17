<script lang="ts">
  import { type CoinChange, fetchCoins } from '#lib/platform.ts'
  import { player } from '#lib/player.svelte.ts'
  import { when } from '#lib/when.ts'

  /** The platform's page of coin changes: a full page means there may be older ones. */
  const PAGE_SIZE = 50

  /** The profile shows the latest few changes; each press shows this many more. */
  const FIRST_SHOWN = 5
  const SHOW_STEP = 20

  /** The profile's coins: the balance, then every change with its reason, newest first, a page at a time. */
  let history = $state<CoinChange[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let hasMore = $state(false)
  let shown = $state(FIRST_SHOWN)
  let loadingMore = $state(false)
  let moreError = $state<string | null>(null)

  $effect(() => {
    void load()
  })

  async function load() {
    try {
      const coins = await fetchCoins()
      player.coins = coins.balance
      history = coins.history
      hasMore = coins.history.length === PAGE_SIZE
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load your coins.'
    } finally {
      loading = false
    }
  }

  /** Shows older changes: the ones already loaded first, then the next page from the platform. */
  async function showMore() {
    shown += SHOW_STEP
    if (shown <= history.length || !hasMore) {
      return
    }

    const last = history.at(-1)
    if (!last) {
      return
    }

    loadingMore = true
    moreError = null

    try {
      const coins = await fetchCoins(last.id)
      history = [...history, ...coins.history]
      hasMore = coins.history.length === PAGE_SIZE
    } catch (err) {
      moreError = err instanceof Error ? err.message : 'Could not load older changes.'
    } finally {
      loadingMore = false
    }
  }

  /** "Fee · Night Owls", "Refund · Friday Cup (cancelled)", "Added by the team · launch gift". */
  function label(change: CoinChange): string {
    const name = change.tournament?.name ?? ''
    const cancelled = change.tournament?.cancelled ? ' (cancelled)' : ''

    switch (change.reason) {
      case 'signup_bonus':
        return 'Account bonus'
      case 'admin_grant':
        return `Added by the team · ${change.note ?? ''}`
      case 'admin_take':
        return `Taken by the team · ${change.note ?? ''}`
      case 'tournament_fee':
        return `Fee · ${name}`
      case 'tournament_refund':
        return `Refund · ${name}${cancelled}`
      case 'tournament_prize':
        return `Prize · ${name}`
      // Only bot accounts get these (tournament fees for bots); listed so every reason has a label.
      case 'bot_funding':
        return 'Bot funding'
    }
  }

  const signed = (amount: number) => `${amount > 0 ? '+' : '−'}${Math.abs(amount).toLocaleString()}`
</script>

<!-- The profile's Coins tab names the section, so its heading is for screen readers only. -->
<section class="mt-6" aria-labelledby="coins-title">
  <h2 id="coins-title" class="sr-only">Coins</h2>
  <div class="rounded-2xl border border-paper/10 bg-panel p-5">
    <p class="flex items-center gap-3">
      <span class="coin size-7 shrink-0 rounded-full" aria-hidden="true"></span>
      <span class="font-display text-3xl font-black text-brass tabular-nums"
        >{player.coins.toLocaleString()}</span
      >
    </p>
    <p class="mt-2 text-sm text-paper/55">
      Virtual coins for tournament fees and prizes. They can’t be bought or cashed out.
    </p>

    {#if loading}
      <p class="mt-4 text-sm text-paper/60" aria-live="polite">Loading…</p>
    {:else if error}
      <p class="mt-4 text-sm text-ember" role="alert">{error}</p>
    {:else if history.length === 0}
      <p class="mt-4 text-sm text-paper/60">No coins have moved yet.</p>
    {:else}
      <ul class="mt-4 divide-y divide-paper/8 border-t border-paper/8">
        {#each history.slice(0, shown) as change (change.id)}
          <li class="flex items-center justify-between gap-4 py-3">
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold">{label(change)}</span>
              <span class="text-xs text-paper/50">{when(change.at)}</span>
            </span>
            <span
              class="shrink-0 text-sm font-extrabold tabular-nums {change.amount > 0
                ? 'text-go'
                : 'text-paper'}">{signed(change.amount)}</span
            >
          </li>
        {/each}
      </ul>
      {#if shown < history.length || hasMore}
        <button
          class="btn-ghost mt-3 min-h-11 w-full"
          onclick={showMore}
          disabled={loadingMore}
          aria-busy={loadingMore}>{loadingMore ? 'Loading…' : 'Show older changes'}</button
        >
      {/if}
      {#if moreError}<p class="mt-2 text-sm text-ember" role="alert">{moreError}</p>{/if}
    {/if}
  </div>
</section>

<style>
  /* A brass coin: the mark beside every balance. */
  .coin {
    background: radial-gradient(
      circle at 35% 30%,
      var(--color-brass) 0 55%,
      var(--color-brass-dim) 100%
    );
    box-shadow: inset 0 0 0 2px rgb(34 28 22 / 0.35);
  }
</style>
