<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · Backoffice</title></svelte:head>

<div class="grid min-h-dvh place-items-center py-10">
	<div class="panel w-full max-w-sm p-6 sm:p-8">
		<span
			class="grid size-10 place-items-center rounded-lg bg-felt-deep text-sm font-semibold tracking-wide text-white"
			aria-hidden="true">BC</span
		>
		<h1 class="mt-5 text-xl font-semibold tracking-tight">BlueClouds Backoffice</h1>
		<p class="mt-1 text-sm text-muted">Staff only. Admin accounts are created on the server.</p>
		<form
			method="POST"
			class="mt-6 space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<div>
				<label class="label" for="username">Username</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="field"
					id="username"
					name="username"
					value={form?.username ?? ''}
					autocomplete="username"
					autocapitalize="none"
					required
					autofocus
				/>
			</div>
			<div>
				<label class="label" for="password">Password</label>
				<input
					class="field"
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			{#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}
			<button class="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
		</form>
	</div>
</div>
