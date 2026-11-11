<script lang="ts">
	import { createAccount, type FormErrors, logIn, logOut, NAME_MAX, player } from '#lib/player.svelte.ts';

	/** Create an account (a guest becomes it, history and all), sign in on this device, or sign out. */
	let name = $state('');
	let username = $state('');
	let password = $state('');
	let loginName = $state('');
	let loginPassword = $state('');
	let created = $state<FormErrors | null>(null);
	let signedIn = $state<FormErrors | null>(null);
	let outError = $state<string | null>(null);
	let busy = $state(false);

	// Prefill the name the guest already plays under.
	$effect(() => {
		if (player.ready && !name) name = player.name;
	});

	async function run<T>(fn: () => Promise<T>): Promise<T> {
		busy = true;
		try {
			return await fn();
		} finally {
			busy = false;
		}
	}
	const create = (e: SubmitEvent) => (e.preventDefault(), run(async () => (created = await createAccount({ name, username, password }))));
	const signIn = (e: SubmitEvent) => (e.preventDefault(), run(async () => (signedIn = await logIn({ username: loginName, password: loginPassword }))));
	const signOut = () => run(async () => (outError = await logOut()));
</script>

<svelte:head><title>Account · BlueClouds Games</title></svelte:head>

<section class="pt-10 md:pt-16">
	<h1 class="font-display text-4xl leading-tight font-black sm:text-5xl">Your account</h1>
</section>

{#if !player.ready}
	<p class="mt-6 text-paper/75">Loading…</p>
{:else if player.username}
	<section class="mt-8 max-w-md rounded-xl border border-paper/15 bg-[#1b1611] p-6" aria-label="Signed in">
		<p>Signed in as <b class="font-semibold">{player.name}</b> <span class="text-paper/75">(@{player.username})</span>.</p>
		<p class="mt-2 text-sm text-paper/75">Your games are saved to this account. Sign in with the same username on another device to keep playing there.</p>
		<div class="mt-5 flex flex-wrap gap-3">
			<a class="btn-brass" href="/">Back to the games</a>
			<button class="btn-ghost" onclick={signOut} disabled={busy}>Sign out</button>
		</div>
		{#if outError}<p class="mt-3 text-sm text-ember" role="alert">{outError}</p>{/if}
	</section>
{:else}
	<div class="mt-8 grid gap-6 md:grid-cols-2">
		<section class="rounded-xl border border-paper/15 bg-[#1b1611] p-6" aria-labelledby="create-title">
			<h2 id="create-title" class="font-display text-2xl font-bold">Create an account</h2>
			<p class="mt-1 text-sm text-paper/75">
				{player.name ? `Your games as ${player.name} move to the account. ` : ''}Play from any device with one username.
			</p>
			<form class="mt-4 space-y-3" onsubmit={create}>
				<label class="block">
					<span class="label mb-1.5 block">Display name</span>
					<input class="field" bind:value={name} maxlength={NAME_MAX} autocomplete="nickname" required aria-invalid={!!created?.fields.name} />
					{#if created?.fields.name}<span class="mt-1 block text-sm text-ember">{created.fields.name}</span>{/if}
				</label>
				<label class="block">
					<span class="label mb-1.5 block">Username</span>
					<input class="field" bind:value={username} maxlength="32" autocomplete="username" autocapitalize="none" required aria-invalid={!!created?.fields.username} />
					<span class="mt-1 block text-sm {created?.fields.username ? 'text-ember' : 'text-paper/75'}">{created?.fields.username ?? '3–32 characters: a–z, 0–9, _ . -'}</span>
				</label>
				<label class="block">
					<span class="label mb-1.5 block">Password</span>
					<input class="field" type="password" bind:value={password} minlength="8" maxlength="200" autocomplete="new-password" required aria-invalid={!!created?.fields.password} />
					<span class="mt-1 block text-sm {created?.fields.password ? 'text-ember' : 'text-paper/75'}">{created?.fields.password ?? 'At least 8 characters.'}</span>
				</label>
				{#if created?.form}<p class="text-sm text-ember" role="alert">{created.form}</p>{/if}
				<button class="btn-brass w-full" type="submit" disabled={busy}>Create account</button>
			</form>
		</section>

		<section class="rounded-xl border border-paper/15 bg-[#1b1611] p-6" aria-labelledby="signin-title">
			<h2 id="signin-title" class="font-display text-2xl font-bold">Sign in</h2>
			<p class="mt-1 text-sm text-paper/75">Already have an account? Pick up where you left off.</p>
			<form class="mt-4 space-y-3" onsubmit={signIn}>
				<label class="block">
					<span class="label mb-1.5 block">Username</span>
					<input class="field" bind:value={loginName} maxlength="64" autocomplete="username" autocapitalize="none" required />
				</label>
				<label class="block">
					<span class="label mb-1.5 block">Password</span>
					<input class="field" type="password" bind:value={loginPassword} maxlength="200" autocomplete="current-password" required />
				</label>
				{#if signedIn}<p class="text-sm text-ember" role="alert">{signedIn.form ?? Object.values(signedIn.fields)[0]}</p>{/if}
				<button class="btn-ghost w-full" type="submit" disabled={busy}>Sign in</button>
			</form>
		</section>
	</div>
{/if}
