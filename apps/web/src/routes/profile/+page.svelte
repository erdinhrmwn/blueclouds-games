<script lang="ts">
	import { goto } from '$app/navigation';
	import { GAMES, gameBySlug } from '#lib/games/catalog.ts';
	import { WELCOME } from '#lib/guest.ts';
	import { createAccount, type FormErrors, logOut, NAME_MAX, player } from '#lib/player.svelte.ts';
	import PasswordDialog from '#lib/components/PasswordDialog.svelte';
	import { when } from '#lib/when.ts';
	import { onMount } from 'svelte';

	let { data } = $props();

	/**
	 * Who you are, how you play each game, and your latest matches. A guest can't rename; linking an account here
	 * is where it picks a name, games and all.
	 */
	// Prefilled once the player loads, then the field owns it.
	let name = $derived(player.name);
	let username = $state('');
	let password = $state('');
	let errors = $state<FormErrors | null>(null);
	let busy = $state(false);
	let linked = $state(false);
	let linking = $state(false);
	let logOutError = $state<string | null>(null);
	let changingPassword = $state(false);

	// Dates follow the visitor's own clock and language, so they are written in the browser only.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	async function link(event: SubmitEvent) {
		event.preventDefault();

		busy = true;
		errors = await createAccount({ name, username, password });
		busy = false;
		linked = !errors;
		linking = !linked;
	}

	async function signOut() {
		const error = await logOut();
		logOutError = error;
		if (!error) await goto(WELCOME, { invalidateAll: true });
	}

	/** One row per game in the catalog, played or not, so a new game shows up here by itself. */
	const byGame = $derived(
		GAMES.map((game) => {
			const record = data.stats.find((s) => s.game === game.slug);
			return {
				game,
				played: record?.played ?? 0,
				wins: record?.wins ?? 0,
				bestStreak: record?.bestStreak ?? 0
			};
		})
	);
	const played = $derived(byGame.reduce((sum, row) => sum + row.played, 0));
	const wins = $derived(byGame.reduce((sum, row) => sum + row.wins, 0));
	const rate = (won: number, total: number) => (total ? Math.round((won / total) * 100) : 0);
	const tiles = $derived([
		{ label: 'Matches', value: String(played) },
		{ label: 'Wins', value: String(wins) },
		{ label: 'Win rate', value: `${rate(wins, played)}%` }
	]);

	const SUFFIX: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
	const ordinal = (place: number) => `${place}${SUFFIX[place] ?? 'th'}`;
</script>

<svelte:head><title>Profile · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-3xl pt-10 pb-16 md:pt-16">
	{#if player.ready}
		<header class="flex items-start gap-5">
			<span
				class="grid size-16 shrink-0 place-items-center rounded-[18px] bg-brass font-display text-3xl font-bold text-ink sm:size-[4.5rem]"
				aria-hidden="true">{player.name.trim().charAt(0).toUpperCase()}</span
			>
			<div class="min-w-0">
				<h1 class="font-display text-3xl leading-tight font-black break-words sm:text-4xl">
					{player.name}
				</h1>
				<p class="mt-1 text-sm text-paper/60">
					{#if player.guest}
						Guest. This name lives in this browser only.
					{:else}
						@{player.username}. Log in with it on any device.
					{/if}
				</p>
				{#if !player.guest}
					<button class="btn-ghost mt-3 min-h-9 px-4 py-1.5" onclick={() => (player.editing = true)}
						>Change name</button
					>
				{/if}
			</div>
		</header>
		{#if linked}<p class="mt-4 text-sm text-brass" role="status">Account linked.</p>{/if}

		{#if player.guest}
			<div class="mt-8 rounded-2xl border-[1.5px] border-brass bg-panel p-6">
				<h2 class="font-display text-xl font-bold">Keep your name and history</h2>
				<p class="mt-1 text-sm text-paper/65">
					Guest progress stays in this browser. Make an account to keep it and play from anywhere.
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

		<dl class="mt-8 grid grid-cols-3 gap-3">
			{#each tiles as tile (tile.label)}
				<div class="rounded-2xl border border-paper/10 bg-panel px-4 py-4 sm:px-5">
					<dt class="text-xs text-paper/55">{tile.label}</dt>
					<dd class="mt-1 font-display text-2xl font-black tabular-nums sm:text-3xl">
						{tile.value}
					</dd>
				</div>
			{/each}
		</dl>

		<h2 class="mt-12 font-display text-xl font-bold">By game</h2>
		<ul class="mt-4 space-y-2.5">
			{#each byGame as row (row.game.slug)}
				{@const percent = rate(row.wins, row.played)}
				<li class="flex items-center gap-4 rounded-2xl border border-paper/10 bg-panel p-4">
					<span
						class="card-back {row.game.back} block h-14 w-10 shrink-0 -rotate-3"
						aria-hidden="true"
					></span>
					<div class="min-w-0 flex-1">
						<p class="font-display text-lg font-bold">{row.game.name}</p>
						<p class="text-sm text-paper/70 tabular-nums">
							{row.played} played, {row.wins}
							{row.wins === 1 ? 'win' : 'wins'}
						</p>
						{#if row.bestStreak > 1}
							<p class="text-xs text-paper/50">Best: {row.bestStreak} wins in a row</p>
						{/if}
						<div
							class="mt-2 h-1.5 rounded-full bg-paper/12"
							role="img"
							aria-label="Win rate {percent}%"
						>
							<div class="h-full rounded-full bg-brass" style="width: {percent}%"></div>
						</div>
					</div>
					<p class="shrink-0 font-display text-xl font-bold tabular-nums max-sm:hidden">
						{percent}%
					</p>
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
							<span
								class="card-back {game?.back ?? ''} block h-9 w-[1.6rem] shrink-0 -rotate-3"
								aria-hidden="true"
							></span>
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

		{#if !player.guest}
			<h2 class="mt-12 font-display text-xl font-bold">Account</h2>
			<div class="mt-4 divide-y divide-paper/10 rounded-xl border border-paper/10 bg-panel">
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
