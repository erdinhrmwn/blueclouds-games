<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createAccount, type FormErrors, NAME_MAX, nextPath, player } from '#lib/player.svelte.ts';

	/** Sign up: a guest playing in this browser becomes the account, history and all. */
	let name = $state('');
	let username = $state('');
	let password = $state('');
	let errors = $state<FormErrors | null>(null);
	let busy = $state(false);

	// Prefill the name the guest already plays under.
	$effect(() => {
		if (player.ready && !name) name = player.name;
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		errors = await createAccount({ name, username, password });
		busy = false;
		if (!errors) await goto(nextPath(page.url));
	}
</script>

<svelte:head><title>Sign up · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-md pt-10 md:pt-16">
	<h1 class="font-display text-4xl leading-tight font-black">Sign up</h1>
	{#if player.ready && player.username}
		<p class="mt-4 text-paper/80">You're already logged in as <b class="font-semibold text-paper">{player.name}</b>.</p>
		<a class="btn-brass mt-5" href={nextPath(page.url)}>Back to the games</a>
	{:else}
		<p class="mt-2 text-sm text-paper/75">
			{player.name ? `Your games as ${player.name} move to the account. ` : ''}Play from any device with one username.
		</p>
		<form class="mt-6 space-y-3 rounded-xl border border-paper/15 bg-[#1b1611] p-6" onsubmit={submit}>
			<label class="block">
				<span class="label mb-1.5 block">Display name</span>
				<input class="field" bind:value={name} maxlength={NAME_MAX} autocomplete="nickname" required aria-invalid={!!errors?.fields.name} />
				{#if errors?.fields.name}<span class="mt-1 block text-sm text-ember">{errors.fields.name}</span>{/if}
			</label>
			<label class="block">
				<span class="label mb-1.5 block">Username</span>
				<input class="field" bind:value={username} maxlength="32" autocomplete="username" autocapitalize="none" required aria-invalid={!!errors?.fields.username} />
				<span class="mt-1 block text-sm {errors?.fields.username ? 'text-ember' : 'text-paper/75'}">{errors?.fields.username ?? '3–32 characters: a–z, 0–9, _ . -'}</span>
			</label>
			<label class="block">
				<span class="label mb-1.5 block">Password</span>
				<input class="field" type="password" bind:value={password} minlength="8" maxlength="200" autocomplete="new-password" required aria-invalid={!!errors?.fields.password} />
				<span class="mt-1 block text-sm {errors?.fields.password ? 'text-ember' : 'text-paper/75'}">{errors?.fields.password ?? 'At least 8 characters.'}</span>
			</label>
			{#if errors?.form}<p class="text-sm text-ember" role="alert">{errors.form}</p>{/if}
			<button class="btn-brass w-full" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
		</form>
		<p class="mt-4 text-sm text-paper/75">Already have an account? <a class="link-btn" href="/login{page.url.search}">Log in</a></p>
	{/if}
</section>
