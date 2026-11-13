<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
	const username = $derived(data.admin?.username ?? '');

	const submit = () => {
		busy = true;

		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: true });
			busy = false;
		};
	};
</script>

<svelte:head><title>Your account · Backoffice</title></svelte:head>

<PageHeader
	title="Your account"
	description="Signed in as {username}. Changing your password signs out your other sessions."
/>

{#if form?.message}
	<p class="panel mb-6 border-felt/30 bg-felt-soft px-4 py-3 text-sm text-felt" role="status">
		{form.message}
	</p>
{/if}
{#if form?.error}
	<p class="panel mb-6 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
		{form.error}
	</p>
{/if}

<section class="panel max-w-md" aria-labelledby="password">
	<div class="panel-head">
		<h2 id="password" class="font-semibold">Change password</h2>
	</div>
	<form method="POST" action="?/changePassword" class="space-y-4 p-5" use:enhance={submit}>
		<!-- For password managers: which account this password belongs to. -->
		<input type="text" name="username" value={username} autocomplete="username" hidden readonly />
		<div>
			<label class="label" for="current">Current password</label>
			<input
				class="field"
				id="current"
				name="current"
				type="password"
				autocomplete="current-password"
				required
			/>
		</div>
		<div>
			<label class="label" for="next">New password</label>
			<input
				class="field"
				id="next"
				name="next"
				type="password"
				autocomplete="new-password"
				minlength={data.passwordMin}
				aria-describedby="next-hint"
				required
			/>
			<p id="next-hint" class="mt-1.5 text-xs text-muted">
				At least {data.passwordMin} characters.
			</p>
		</div>
		<div>
			<label class="label" for="repeat">New password again</label>
			<input
				class="field"
				id="repeat"
				name="repeat"
				type="password"
				autocomplete="new-password"
				minlength={data.passwordMin}
				required
			/>
		</div>
		<button class="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
	</form>
</section>
