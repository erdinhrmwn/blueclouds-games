<script lang="ts">
	import { createAccount, type FormErrors, NAME_MAX, player } from '#lib/player.svelte.ts';

	/** Your name and account. A guest can't rename; linking an account here is where it picks a name, games and all. */
	// Prefilled once the player loads, then the field owns it.
	let name = $derived(player.name);
	let username = $state('');
	let password = $state('');
	let errors = $state<FormErrors | null>(null);
	let busy = $state(false);
	let linked = $state(false);

	async function link(event: SubmitEvent) {
		event.preventDefault();

		busy = true;
		errors = await createAccount({ name, username, password });
		busy = false;
		linked = !errors;
	}
</script>

<svelte:head><title>Profile · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-md pt-10 md:pt-16">
	<h1 class="font-display text-4xl leading-tight font-black">Your profile</h1>

	{#if player.ready}
		<div class="mt-6 rounded-xl border border-paper/15 bg-[#1b1611] p-6">
			<p class="label">Display name</p>
			<div class="mt-1 flex flex-wrap items-center justify-between gap-3">
				<p class="min-w-0 font-display text-2xl font-bold break-words">{player.name}</p>
				{#if !player.guest}<button
						class="btn-ghost shrink-0 px-4"
						onclick={() => (player.editing = true)}>Change name</button
					>{/if}
			</div>
			<p class="mt-4 text-sm text-paper/75">
				{#if player.guest}
					Guest <b class="font-semibold text-paper">@{player.username}</b>. Saved in this browser
					only.
				{:else}
					<b class="font-semibold text-paper">@{player.username}</b>. Log in with it on any device.
				{/if}
			</p>
			{#if linked}<p class="mt-2 text-sm text-brass" role="status">Account linked.</p>{/if}
		</div>

		{#if player.guest}
			<form
				class="mt-6 space-y-3 rounded-xl border border-paper/15 bg-[#1b1611] p-6"
				onsubmit={link}
				aria-labelledby="link-title"
			>
				<h2 id="link-title" class="font-display text-2xl font-bold">Link an account</h2>
				<p class="text-sm text-paper/75">
					Pick your name and play from any device. Your games stay.
				</p>
				<label class="block">
					<span class="label mb-1.5 block">Display name</span>
					<input
						class="field"
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
						class="field"
						bind:value={username}
						maxlength="32"
						autocomplete="username"
						autocapitalize="none"
						required
						aria-invalid={!!errors?.fields.username}
					/>
					<span
						class="mt-1 block text-sm {errors?.fields.username ? 'text-ember' : 'text-paper/75'}"
						>{errors?.fields.username ?? '3–32 characters: a–z, 0–9, _ . -'}</span
					>
				</label>
				<label class="block">
					<span class="label mb-1.5 block">Password</span>
					<input
						class="field"
						type="password"
						bind:value={password}
						minlength="8"
						maxlength="200"
						autocomplete="new-password"
						required
						aria-invalid={!!errors?.fields.password}
					/>
					<span
						class="mt-1 block text-sm {errors?.fields.password ? 'text-ember' : 'text-paper/75'}"
						>{errors?.fields.password ?? 'At least 8 characters.'}</span
					>
				</label>
				{#if errors?.form}<p class="text-sm text-ember" role="alert">{errors.form}</p>{/if}
				<button class="btn-brass w-full" type="submit" disabled={busy}
					>{busy ? 'Linking…' : 'Link account'}</button
				>
			</form>
		{/if}
	{/if}
</section>
