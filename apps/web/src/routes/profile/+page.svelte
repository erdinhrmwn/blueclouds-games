<script lang="ts">
  import Icon from '#lib/components/Icon.svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { GAMES, gameBySlug } from '#lib/games/catalog.ts'
  import { WELCOME } from '#lib/guest.ts'
  import { createAccount, type FormErrors, logOut, NAME_MAX, player } from '#lib/player.svelte.ts'
  import Avatar from '#lib/components/Avatar.svelte'
  import AvatarDialog from '#lib/components/AvatarDialog.svelte'
  import CoinsPanel from '#lib/components/CoinsPanel.svelte'
  import MyTournaments from '#lib/components/MyTournaments.svelte'
  import PasswordDialog from '#lib/components/PasswordDialog.svelte'
  import { ordinal } from '#lib/tournament-formats.ts'
  import { when } from '#lib/when.ts'
  import { onMount } from 'svelte'

  let { data } = $props()

  /**
   * Who you are, how you play each game, your tournaments and latest matches. Linking an account here is where a
   * guest picks a name, games and all.
   */
  // Prefilled once the player loads, then the field owns it.
  let name = $derived(player.name)
  let username = $state('')
  let password = $state('')
  let errors = $state<FormErrors | null>(null)
  let busy = $state(false)
  let linked = $state(false)
  let linking = $state(false)
  let logOutError = $state<string | null>(null)
  let changingPassword = $state(false)
  let pickingAvatar = $state(false)

  // Dates follow the visitor's own clock and language, so they are written in the browser only.
  let mounted = $state(false)
  onMount(() => {
    mounted = true
  })

  async function link(event: SubmitEvent) {
    event.preventDefault()

    busy = true
    errors = await createAccount({ name, username, password })
    busy = false
    linked = !errors
    linking = !linked
  }

  async function signOut() {
    const error = await logOut()
    logOutError = error
    if (!error) {
      await goto(WELCOME, { invalidateAll: true })
    }
  }

  /** One row per game in the catalog, played or not, so a new game shows up here by itself. */
  const byGame = $derived(
    GAMES.map((game) => {
      const record = data.stats.find((stat) => stat.game === game.slug)
      return {
        game,
        played: record?.played ?? 0,
        wins: record?.wins ?? 0,
        bestStreak: record?.bestStreak ?? 0,
        currentStreak: record?.currentStreak ?? 0,
        averagePlace: record?.averagePlace ?? 0,
        rounds: record?.rounds ?? { played: 0, won: null },
      }
    }),
  )
  const played = $derived(byGame.reduce((sum, row) => sum + row.played, 0))
  const wins = $derived(byGame.reduce((sum, row) => sum + row.wins, 0))
  const rate = (won: number, total: number) => (total ? Math.round((won / total) * 100) : 0)
  const tiles = $derived([
    { label: 'Matches', value: String(played) },
    { label: 'Wins', value: String(wins) },
    { label: 'Win rate', value: `${rate(wins, played)}%` },
  ])

  /** "member since Nov 2026", in the visitor's own language; empty until the date is known. */
  const memberSince = $derived.by(() => {
    if (!mounted || !player.createdAt) {
      return ''
    }

    const month = new Date(player.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    })
    return `member since ${month}`
  })

  /** The profile's sections; guests have no coins or account settings yet. */
  const tabs = $derived(
    [
      { id: 'overview', label: 'Overview' },
      { id: 'tournaments', label: 'Tournaments' },
      { id: 'coins', label: 'Coins', accountOnly: true },
      { id: 'account', label: 'Account', accountOnly: true },
    ].filter((tab) => !(tab.accountOnly && player.guest)),
  )

  /** The open section lives in the URL (`?tab=coins`), so it can be linked; anything else opens the overview. */
  const activeTab = $derived.by(() => {
    const asked = page.url.searchParams.get('tab')

    return tabs.some((tab) => tab.id === asked) ? asked : 'overview'
  })

  /** The latest finished matches, oldest first, so the strip reads left to right up to now. */
  const form = $derived([...data.form.filter((match) => match.endReason === 'finished')].reverse())

  /** "Avg place 1.8 · 3 wins in a row now · Best: 4 in a row", each part only when it says something. */
  function recordLine(row: (typeof byGame)[number]): string {
    const parts = [`Avg place ${row.averagePlace.toFixed(1)}`]

    if (row.currentStreak > 1) {
      parts.push(`${row.currentStreak} wins in a row now`)
    }

    // The best run is news only when it isn't the one still going.
    if (row.bestStreak > 1 && row.bestStreak > row.currentStreak) {
      parts.push(`Best: ${row.bestStreak} in a row`)
    }

    return parts.join(' · ')
  }
</script>

<svelte:head><title>Profile · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-[50rem] pt-10 pb-16 md:pt-16">
  {#if player.ready}
    <header class="flex items-start gap-5">
      <!-- Everyone can change their look, guests too: unlike a name it isn't tied to an account. -->
      <button
        class="group relative shrink-0 rounded-[18px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass"
        onclick={() => (pickingAvatar = true)}
        aria-label="Change avatar"
        title="Change avatar"
      >
        <Avatar
          id={player.id}
          name={player.name}
          avatar={player.avatar}
          class="size-16 rounded-[18px] text-3xl sm:size-[4.5rem]"
        />
        <span
          class="absolute -right-1.5 -bottom-1.5 grid size-7 place-items-center rounded-full border-2 border-room bg-brass text-ink group-hover:brightness-110"
          aria-hidden="true"
        >
          <Icon name="edit" class="size-3.5" />
        </span>
      </button>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h1
            class="min-w-0 font-display text-3xl leading-tight font-black break-words sm:text-4xl"
          >
            {player.name}
          </h1>
          <!-- Guests pick their name when they make an account, so only accounts can rename here. -->
          {#if !player.guest}
            <button
              class="grid size-9 shrink-0 place-items-center rounded-lg text-paper/60 hover:bg-paper/8 hover:text-paper focus-visible:outline-2 focus-visible:outline-brass"
              onclick={() => (player.editing = true)}
              aria-label="Change name"
              title="Change name"
            >
              <Icon name="edit" class="size-[18px]" />
            </button>
          {/if}
        </div>
        <p class="mt-1 text-sm text-paper/60">
          {#if player.guest}
            Guest · this name lives on this device only
          {:else}
            @{player.username}{memberSince ? ` · ${memberSince}` : ''}
          {/if}
        </p>
      </div>
    </header>
    <AvatarDialog bind:open={pickingAvatar} />
    {#if linked}<p class="mt-4 text-sm text-brass" role="status">Account linked.</p>{/if}

    {#if data.seats.length > 0}
      <section class="mt-8 space-y-2" aria-label="Your tournament tables">
        {#each data.seats as seat (seat.code)}
          {@const game = gameBySlug(seat.game)}
          <div
            class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border-[1.5px] border-brass bg-panel p-4"
          >
            {#if game}
              <game.Emblem small class="size-10 shrink-0" />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="font-semibold">
                {seat.started ? 'Your table is playing' : 'Your table is ready'}
              </p>
              <p class="truncate text-sm text-paper/65">
                {seat.tournament.name} · {game?.name ?? seat.game}
              </p>
            </div>
            <a class="btn-brass min-h-11 px-5" href="/{seat.game}/room/{seat.code}"
              >{seat.started ? 'Rejoin' : 'Take your seat'}</a
            >
          </div>
        {/each}
      </section>
    {/if}

    {#if player.guest}
      <div class="mt-8 rounded-2xl border-[1.5px] border-brass bg-panel p-6">
        <h2 class="font-display text-xl font-bold">Keep your name and history</h2>
        <p class="mt-1 text-sm text-paper/65">
          Guest progress stays on this device. Make an account to keep it.
        </p>
        {#if !linking}
          <button class="btn-brass mt-4" onclick={() => (linking = true)}>Create account</button>
        {:else}
          <form class="mt-5 space-y-4" onsubmit={link} aria-label="Create account">
            <label class="block">
              <span class="label mb-1.5 block">Display name</span>
              <input
                class="field h-12 rounded-xl"
                bind:value={name}
                maxlength={NAME_MAX}
                autocomplete="nickname"
                required
                aria-invalid={!!errors?.fields.name}
              />
              {#if errors?.fields.name}<span class="mt-1 block text-sm text-ember"
                  >{errors.fields.name}</span
                >{/if}
            </label>
            <label class="block">
              <span class="label mb-1.5 block">Username</span>
              <input
                class="field h-12 rounded-xl"
                bind:value={username}
                maxlength="32"
                autocomplete="username"
                autocapitalize="none"
                required
                aria-invalid={!!errors?.fields.username}
              />
              <span
                class="mt-1 block text-xs {errors?.fields.username
                  ? 'text-ember'
                  : 'text-paper/55'}"
                >{errors?.fields.username ?? '3–32 characters: a–z, 0–9, _ . -'}</span
              >
            </label>
            <label class="block">
              <span class="label mb-1.5 block">Password</span>
              <input
                class="field h-12 rounded-xl"
                type="password"
                bind:value={password}
                minlength="8"
                maxlength="200"
                autocomplete="new-password"
                required
                aria-invalid={!!errors?.fields.password}
              />
              <span
                class="mt-1 block text-xs {errors?.fields.password
                  ? 'text-ember'
                  : 'text-paper/55'}">{errors?.fields.password ?? 'At least 8 characters.'}</span
              >
            </label>
            {#if errors?.form}<p class="text-sm text-ember" role="alert">{errors.form}</p>{/if}
            <button class="btn-brass h-12 w-full rounded-xl" type="submit" disabled={busy}
              >{busy ? 'Creating…' : 'Create account'}</button
            >
          </form>
        {/if}
      </div>
    {/if}

    <nav class="mt-8 -mx-1 overflow-x-auto border-b border-paper/10" aria-label="Profile sections">
      <ul class="flex min-w-max gap-1 px-1">
        {#each tabs as tab (tab.id)}
          {@const current = tab.id === activeTab}
          <li>
            <a
              href={tab.id === 'overview' ? '/profile' : `?tab=${tab.id}`}
              aria-current={current ? 'page' : undefined}
              data-sveltekit-noscroll
              class="-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brass {current
                ? 'border-brass text-paper'
                : 'border-transparent text-paper/60 hover:text-paper'}">{tab.label}</a
            >
          </li>
        {/each}
      </ul>
    </nav>

    {#if activeTab === 'overview'}
      <dl class="mt-6 grid grid-cols-3 gap-3">
        {#each tiles as tile (tile.label)}
          <div
            class="flex flex-col-reverse rounded-2xl border border-paper/10 bg-panel px-4 py-4 sm:px-5"
          >
            <dt class="mt-1 text-xs text-paper/55">{tile.label}</dt>
            <dd class="font-display text-2xl font-black tabular-nums sm:text-3xl">
              {tile.value}
            </dd>
          </div>
        {/each}
      </dl>

      {#if form.length > 0}
        <div class="mt-4 rounded-2xl border border-paper/10 bg-panel px-4 py-4 sm:px-5">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="text-sm font-semibold">Recent form</h2>
            <p class="text-xs text-paper/50">Latest on the right</p>
          </div>
          <ol
            class="mt-3 grid grid-cols-10 gap-1.5"
            aria-label="Your last {form.length} finished matches"
          >
            {#each form as match (match.id)}
              {@const won = match.placement === 1}
              {@const name = gameBySlug(match.game)?.name ?? match.game}
              <li
                class="grid aspect-square max-w-11 place-items-center rounded-lg text-[11px] font-bold tabular-nums sm:text-xs {won
                  ? 'bg-brass text-ink'
                  : 'bg-black/35 text-paper/80'}"
                title="{name}: {ordinal(match.placement)} of {match.players}"
              >
                <span class="sr-only">{name}:</span>{ordinal(match.placement)}<span class="sr-only"
                  >of {match.players}</span
                >
              </li>
            {/each}
          </ol>
        </div>
      {/if}

      <h2 class="mt-12 font-display text-xl font-bold">By game</h2>
      <ul class="mt-4 space-y-2.5">
        {#each byGame as row (row.game.slug)}
          {@const percent = rate(row.wins, row.played)}
          <li class="flex items-center gap-4 rounded-2xl border border-paper/10 bg-panel p-4">
            <row.game.Emblem class="size-12 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="font-display text-lg font-bold">{row.game.name}</p>
              <p class="text-sm text-paper/70 tabular-nums">
                {row.played} played · {row.wins}
                {row.wins === 1 ? 'win' : 'wins'}
              </p>
              {#if row.played > 0}
                <p class="mt-0.5 text-xs text-paper/55 tabular-nums">{recordLine(row)}</p>
              {/if}
              {#if row.rounds.played > 0 && row.rounds.won !== null}
                <p class="mt-0.5 text-xs text-paper/55 tabular-nums">
                  {row.game.roundsLine(row.rounds.won, row.rounds.played)}
                </p>
              {/if}
              {#if row.played > 0}
                <a
                  class="mt-1 inline-block py-1 text-xs font-semibold text-brass hover:underline"
                  href="/history?game={row.game.slug}">{row.game.name} matches</a
                >
              {/if}
              <!-- Phones: the bar under the text. From sm up it moves to the right column. -->
              <div
                class="mt-2.5 h-1.5 rounded-full bg-paper/12 sm:hidden"
                role="img"
                aria-label="Win rate {percent}%"
              >
                <div class="h-full rounded-full bg-brass" style="width: {percent}%"></div>
              </div>
            </div>
            <div class="w-40 shrink-0 text-right max-sm:hidden">
              <p class="font-display text-xl font-bold tabular-nums">{percent}%</p>
              <div class="mt-2 h-1.5 rounded-full bg-paper/12" aria-hidden="true">
                <div class="h-full rounded-full bg-brass" style="width: {percent}%"></div>
              </div>
              <p class="mt-2 text-xs text-paper/50">win rate</p>
            </div>
          </li>
        {/each}
      </ul>

      <div class="mt-12 flex items-baseline justify-between">
        <h2 class="font-display text-xl font-bold">Recent matches</h2>
        <a class="text-sm font-semibold text-brass hover:underline" href="/history">All matches</a>
      </div>
      {#if data.recent.length === 0}
        <p class="mt-4 rounded-2xl border border-dashed border-paper/20 p-6 text-sm text-paper/65">
          No finished matches yet.
        </p>
      {:else}
        <ul class="mt-4 space-y-2">
          {#each data.recent as match (match.id)}
            {@const game = gameBySlug(match.game)}
            {@const won = match.placement === 1 && match.endReason === 'finished'}
            <li>
              <a
                href="/history/{match.id}"
                class="flex items-center gap-4 rounded-xl border border-paper/10 bg-panel px-4 py-3 hover:border-paper/30"
              >
                {#if game}
                  <game.Emblem small class="size-9 shrink-0" />
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold">{game?.name ?? match.game}</span>
                  <time class="block text-xs text-paper/50" datetime={match.endedAt}
                    >{mounted ? when(match.endedAt) : ''}</time
                  >
                </span>
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums {won
                    ? 'bg-brass text-ink'
                    : 'bg-black/35 text-paper/85'}"
                >
                  {match.endReason === 'terminated'
                    ? 'Stopped'
                    : `${ordinal(match.placement)} of ${match.players}`}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if activeTab === 'tournaments'}
      <MyTournaments tournaments={data.tournaments} record={data.tournamentRecord} {mounted} />
    {:else if activeTab === 'coins'}
      <CoinsPanel />
    {:else if activeTab === 'account'}
      <h2 class="sr-only">Account</h2>
      <div class="mt-6 divide-y divide-paper/10 rounded-xl border border-paper/10 bg-panel">
        <div class="flex items-center justify-between px-5 py-4">
          <span class="text-sm text-paper/70">Username</span>
          <span class="font-semibold">@{player.username}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-paper/70">Password</span>
          <button
            class="min-h-10 px-1 text-sm font-semibold text-brass hover:underline"
            onclick={() => (changingPassword = true)}>Change</button
          >
        </div>
      </div>
      <PasswordDialog bind:open={changingPassword} />
      <button
        class="mt-3 h-12 w-full rounded-xl border border-ember/60 font-semibold text-ember hover:bg-ember/10"
        onclick={signOut}>Log out</button
      >
      {#if logOutError}<p class="mt-2 text-sm text-ember" role="alert">{logOutError}</p>{/if}
    {/if}
  {/if}
</section>
