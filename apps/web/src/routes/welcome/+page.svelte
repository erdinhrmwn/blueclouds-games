<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { nextPath } from '#lib/guest.ts';
	import {
		createAccount,
		type FormErrors,
		logIn,
		NAME_MAX,
		nameError,
		playAsGuest
	} from '#lib/player.svelte.ts';

	let { data } = $props();

	/**
	 * First stop for anyone without a player. Playing as a guest is the page; an account is one link away.
	 * One column, the same field and button sizes in every mode.
	 */
	let mode = $state<'guest' | 'login' | 'signup'>('guest');
	let busy = $state(false);

	// Only the starting name is wanted: the visitor edits it here.
	// svelte-ignore state_referenced_locally
	let guestName = $state(data.guestName);
	let guestError = $state<string | null>(null);

	let username = $state('');
	let password = $state('');
	let name = $state('');
	let errors = $state<FormErrors | null>(null);

	const enter = () => goto(nextPath(page.url), { invalidateAll: true });

	async function run(task: () => Promise<boolean>) {
		if (busy) return;

		busy = true;
		const ok = await task();
		busy = false;

		if (ok) await enter();
	}

	function switchTo(next: typeof mode) {
		mode = next;
		errors = null;
		guestError = null;
	}

	function guest(event: SubmitEvent) {
		event.preventDefault();

		guestError = nameError(guestName);
		if (guestError) return;

		return run(async () => {
			const failed = await playAsGuest(guestName.trim());
			// Show the form message, or else the first field message.
			guestError = failed && (failed.form ?? Object.values(failed.fields)[0]);
			return !failed;
		});
	}

	function account(event: SubmitEvent) {
		event.preventDefault();

		return run(async () => {
			if (mode === 'login') {
				errors = await logIn({ username, password });
			} else {
				errors = await createAccount({ name, username, password });
			}

			return !errors;
		});
	}

	const TITLE = { guest: 'Take a seat', login: 'Log in', signup: 'Sign up' } as const;
	const LEAD = {
		guest: 'Pick a name and play. No sign-up needed.',
		login: 'Welcome back. Your name and history are waiting.',
		signup: 'Keep your name and history on every device.'
	} as const;
</script>

<svelte:head><title>{TITLE[mode]} · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-sm pt-12 text-center md:pt-20">
	<h1 class="font-display text-4xl leading-tight font-black sm:text-[2.75rem]">{TITLE[mode]}</h1>
	<p class="mt-2 text-sm text-paper/60">{LEAD[mode]}</p>

	{#if mode === 'guest'}
		<form class="mt-8 space-y-5 text-left" onsubmit={guest} aria-label="Play as a guest">
			<label class="block">
				<span class="label mb-1.5 block">Your name at the table</span>
				<input
					class="field h-12 rounded-xl"
					bind:value={guestName}
					maxlength={NAME_MAX}
					autocomplete="nickname"
					required
					aria-invalid={!!guestError}
				/>
			</label>
			{#if guestError}<p class="text-sm text-ember" role="alert">{guestError}</p>{/if}
			<button class="btn-brass h-12 w-full rounded-xl text-base" type="submit" disabled={busy}
				>{busy ? 'Please wait…' : 'Play'}</button
			>
		</form>
		<p class="mt-6 text-sm text-paper/60">
			Have an account?
			<button class="font-semibold text-brass hover:underline" onclick={() => switchTo('login')}
				>Log in</button
			>
			or
			<button class="font-semibold text-brass hover:underline" onclick={() => switchTo('signup')}
				>Sign up</button
			>
		</p>
	{:else}
		<form
			class="mt-8 space-y-5 text-left"
			onsubmit={account}
			aria-label={mode === 'login' ? 'Log in' : 'Sign up'}
		>
			{#if mode === 'signup'}
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
			{/if}
			<label class="block">
				<span class="label mb-1.5 block">Username</span>
				<input
					class="field h-12 rounded-xl"
					bind:value={username}
					maxlength={mode === 'signup' ? 32 : 64}
					autocomplete="username"
					autocapitalize="none"
					required
					aria-invalid={!!errors?.fields.username}
				/>
				{#if mode === 'signup'}
					<span
						class="mt-1 block text-xs {errors?.fields.username ? 'text-ember' : 'text-paper/55'}"
						>{errors?.fields.username ?? '3–32 characters: a–z, 0–9, _ . -'}</span
					>
				{/if}
			</label>
			<label class="block">
				<span class="label mb-1.5 block">Password</span>
				<input
					class="field h-12 rounded-xl"
					type="password"
					bind:value={password}
					minlength={mode === 'signup' ? 8 : undefined}
					maxlength="200"
					autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
					required
					aria-invalid={!!errors?.fields.password}
				/>
				{#if mode === 'signup'}
					<span
						class="mt-1 block text-xs {errors?.fields.password ? 'text-ember' : 'text-paper/55'}"
						>{errors?.fields.password ?? 'At least 8 characters.'}</span
					>
				{/if}
			</label>
			{#if mode === 'login' && errors}
				<p class="text-sm text-ember" role="alert">
					{errors.form ?? Object.values(errors.fields)[0]}
				</p>
			{:else if errors?.form}
				<p class="text-sm text-ember" role="alert">{errors.form}</p>
			{/if}
			<button class="btn-brass h-12 w-full rounded-xl text-base" type="submit" disabled={busy}
				>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button
			>
		</form>
		<p class="mt-6 text-sm text-paper/60">
			{#if mode === 'login'}
				New here?
				<button class="font-semibold text-brass hover:underline" onclick={() => switchTo('signup')}
					>Sign up</button
				>
			{:else}
				Have an account?
				<button class="font-semibold text-brass hover:underline" onclick={() => switchTo('login')}
					>Log in</button
				>
			{/if}
			or
			<button class="font-semibold text-brass hover:underline" onclick={() => switchTo('guest')}
				>play as guest</button
			>
		</p>
	{/if}
</section>
