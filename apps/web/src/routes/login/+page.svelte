<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { type FormErrors, logIn, nextPath, player } from '#lib/player.svelte.ts';

	/** Log in on this device. A guest playing here switches to the account (the guest's games stay with the guest). */
	let username = $state('');
	let password = $state('');
	let errors = $state<FormErrors | null>(null);
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		errors = await logIn({ username, password });
		busy = false;
		if (!errors) await goto(nextPath(page.url));
	}
</script>

<svelte:head><title>Log in · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-md pt-10 md:pt-16">
	<h1 class="font-display text-4xl leading-tight font-black">Log in</h1>
	{#if player.ready && player.username}
		<p class="mt-4 text-paper/80">You're already logged in as <b class="font-semibold text-paper">{player.name}</b>.</p>
		<a class="btn-brass mt-5" href={nextPath(page.url)}>Back to the games</a>
	{:else}
		<p class="mt-2 text-sm text-paper/75">Pick up where you left off, on any device.</p>
		<form class="mt-6 space-y-3 rounded-xl border border-paper/15 bg-[#1b1611] p-6" onsubmit={submit}>
			<label class="block">
				<span class="label mb-1.5 block">Username</span>
				<input class="field" bind:value={username} maxlength="64" autocomplete="username" autocapitalize="none" required />
			</label>
			<label class="block">
				<span class="label mb-1.5 block">Password</span>
				<input class="field" type="password" bind:value={password} maxlength="200" autocomplete="current-password" required />
			</label>
			{#if errors}<p class="text-sm text-ember" role="alert">{errors.form ?? Object.values(errors.fields)[0]}</p>{/if}
			<button class="btn-brass w-full" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
		</form>
		<p class="mt-4 text-sm text-paper/75">New here? <a class="link-btn" href="/signup{page.url.search}">Sign up</a></p>
	{/if}
</section>
