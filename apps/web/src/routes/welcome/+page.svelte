<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { nextPath } from '#lib/guest.ts';
	import { createAccount, type FormErrors, logIn, NAME_MAX, playAsGuest } from '#lib/player.svelte.ts';

	/** First stop for anyone without a player: log in, sign up, or play as a guest. */
	let tab = $state<'login' | 'signup'>('login');
	let busy = $state(false);

	let username = $state('');
	let password = $state('');
	let name = $state('');
	let errors = $state<FormErrors | null>(null);

	let guestError = $state<string | null>(null);

	const enter = () => goto(nextPath(page.url), { invalidateAll: true });

	async function run(task: () => Promise<boolean>) {
		if (busy) return;
		busy = true;
		const ok = await task();
		busy = false;
		if (ok) await enter();
	}

	function pick(next: 'login' | 'signup') {
		tab = next;
		errors = null;
	}

	const account = (e: SubmitEvent) => (
		e.preventDefault(),
		run(async () => {
			errors = tab === 'login' ? await logIn({ username, password }) : await createAccount({ name, username, password });
			return !errors;
		})
	);
	const guest = () =>
		run(async () => {
			const failed = await playAsGuest();
			guestError = failed && (failed.form ?? Object.values(failed.fields)[0]);
			return !failed;
		});
</script>

<svelte:head><title>Welcome · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-md pt-8 md:pt-14">
	<h1 class="font-display text-4xl leading-tight font-black sm:text-5xl">Welcome</h1>
	<p class="mt-2 text-paper/80">Card games for friends and bots, right in the browser.</p>

	<div class="mt-6 rounded-xl border border-paper/15 bg-[#1b1611] p-6">
		<div class="grid grid-cols-2 gap-1 rounded-md bg-black/30 p-1" role="group" aria-label="Log in or sign up">
			{#each [['login', 'Log in'], ['signup', 'Sign up']] as const as [key, label] (key)}
				<button
					type="button"
					aria-pressed={tab === key}
					class="min-h-11 rounded-[0.3rem] text-sm font-semibold transition-colors {tab === key ? 'bg-paper text-ink' : 'text-paper/75 hover:text-paper'}"
					onclick={() => pick(key)}>{label}</button
				>
			{/each}
		</div>

		<form class="mt-5 space-y-3" onsubmit={account} aria-label={tab === 'login' ? 'Log in' : 'Sign up'}>
			{#if tab === 'signup'}
				<label class="block">
					<span class="label mb-1.5 block">Display name</span>
					<input class="field" bind:value={name} maxlength={NAME_MAX} autocomplete="nickname" required aria-invalid={!!errors?.fields.name} />
					{#if errors?.fields.name}<span class="mt-1 block text-sm text-ember">{errors.fields.name}</span>{/if}
				</label>
			{/if}
			<label class="block">
				<span class="label mb-1.5 block">Username</span>
				<input class="field" bind:value={username} maxlength={tab === 'signup' ? 32 : 64} autocomplete="username" autocapitalize="none" required aria-invalid={!!errors?.fields.username} />
				{#if tab === 'signup'}
					<span class="mt-1 block text-sm {errors?.fields.username ? 'text-ember' : 'text-paper/75'}">{errors?.fields.username ?? '3–32 characters: a–z, 0–9, _ . -'}</span>
				{/if}
			</label>
			<label class="block">
				<span class="label mb-1.5 block">Password</span>
				{#if tab === 'signup'}
					<input class="field" type="password" bind:value={password} minlength="8" maxlength="200" autocomplete="new-password" required aria-invalid={!!errors?.fields.password} />
					<span class="mt-1 block text-sm {errors?.fields.password ? 'text-ember' : 'text-paper/75'}">{errors?.fields.password ?? 'At least 8 characters.'}</span>
				{:else}
					<input class="field" type="password" bind:value={password} maxlength="200" autocomplete="current-password" required />
				{/if}
			</label>
			{#if tab === 'login' && errors}
				<p class="text-sm text-ember" role="alert">{errors.form ?? Object.values(errors.fields)[0]}</p>
			{:else if errors?.form}
				<p class="text-sm text-ember" role="alert">{errors.form}</p>
			{/if}
			<button class="btn-brass w-full" type="submit" disabled={busy}>{tab === 'login' ? 'Log in' : 'Create account'}</button>
		</form>

		<div class="my-6 flex items-center gap-3 text-sm text-paper/75" aria-hidden="true">
			<span class="h-px flex-1 bg-paper/15"></span>or<span class="h-px flex-1 bg-paper/15"></span>
		</div>

		<div class="space-y-3">
			<button class="btn-ghost w-full" onclick={guest} disabled={busy}>Play as guest</button>
			{#if guestError}<p class="text-sm text-ember" role="alert">{guestError}</p>{/if}
			<p class="text-sm text-paper/75">You get a name like Guest 482193. Link an account later to pick your own.</p>
		</div>
	</div>
</section>
