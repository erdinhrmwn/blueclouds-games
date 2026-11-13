<script lang="ts">
	import { PlatformError, updatePassword } from '#lib/platform.ts';

	/** Changing an account's password. Other devices are signed out; this one stays signed in. */
	let { open = $bindable(false) }: { open?: boolean } = $props();

	const PASSWORD_MIN = 8;

	let dialog = $state<HTMLDialogElement>();
	let currentPassword = $state('');
	let newPassword = $state('');
	let fields = $state<Record<string, string>>({});
	let error = $state<string | null>(null);
	let busy = $state(false);
	let done = $state(false);

	$effect(() => {
		if (!dialog) return;

		if (open && !dialog.open) {
			currentPassword = '';
			newPassword = '';
			fields = {};
			error = null;
			done = false;
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		busy = true;
		fields = {};
		error = null;

		try {
			await updatePassword({ currentPassword, newPassword });
			done = true;
		} catch (err) {
			fields = err instanceof PlatformError ? err.fields : {};
			const hasFields = Object.keys(fields).length > 0;
			error = hasFields ? null : err instanceof Error ? err.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="password-title"
	class="modal"
>
	{#if done}
		<h2 id="password-title" class="modal-title">Password changed</h2>
		<p class="mt-2 text-sm text-paper/70">
			Your other devices were signed out. Log in there with the new password.
		</p>
		<div class="mt-6 flex justify-end">
			<button class="btn-brass" onclick={() => (open = false)}>Done</button>
		</div>
	{:else}
		<form onsubmit={submit} class="space-y-5">
			<div>
				<h2 id="password-title" class="modal-title">Change password</h2>
				<p class="mt-1 text-sm text-paper/60">Your other devices will be signed out.</p>
			</div>
			<label class="block">
				<span class="label mb-1.5 block">Current password</span>
				<input
					class="field h-12 rounded-xl"
					type="password"
					bind:value={currentPassword}
					maxlength="200"
					autocomplete="current-password"
					required
					aria-invalid={!!fields.currentPassword}
				/>
				{#if fields.currentPassword}<span class="mt-1 block text-sm text-ember"
						>{fields.currentPassword}</span
					>{/if}
			</label>
			<label class="block">
				<span class="label mb-1.5 block">New password</span>
				<input
					class="field h-12 rounded-xl"
					type="password"
					bind:value={newPassword}
					minlength={PASSWORD_MIN}
					maxlength="200"
					autocomplete="new-password"
					required
					aria-invalid={!!fields.newPassword}
				/>
				<span class="mt-1 block text-xs {fields.newPassword ? 'text-ember' : 'text-paper/55'}"
					>{fields.newPassword ?? `At least ${PASSWORD_MIN} characters.`}</span
				>
			</label>
			{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}
			<div class="flex justify-end gap-3">
				<button type="button" class="btn-ghost" onclick={() => (open = false)}>Cancel</button>
				<button type="submit" class="btn-brass" disabled={busy}
					>{busy ? 'Saving…' : 'Change password'}</button
				>
			</div>
		</form>
	{/if}
</dialog>
