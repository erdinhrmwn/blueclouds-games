<script lang="ts">
	import { NAME_MAX, player, setPlayerName } from '#lib/player.svelte.ts';

	/** Rename yourself: opened from the profile page, cancel with Esc or Cancel. */
	let dialog = $state<HTMLDialogElement>();
	let draft = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);

	$effect(() => {
		if (!dialog) return;

		if (player.editing && !dialog.open) {
			draft = player.name;
			error = null;
			dialog.showModal();
		} else if (!player.editing && dialog.open) {
			dialog.close();
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;

		saving = true;
		error = await setPlayerName(draft);
		saving = false;
	}
</script>

<dialog
	bind:this={dialog}
	onclose={() => (player.editing = false)}
	aria-labelledby="name-title"
	class="modal"
>
	<form onsubmit={submit} class="space-y-4">
		<div>
			<h2 id="name-title" class="modal-title">Change your name</h2>
			<p class="mt-1 text-sm text-paper/65">Other players see this name at the table.</p>
		</div>
		<label class="block">
			<span class="label mb-1.5 block">Your name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="field"
				bind:value={draft}
				maxlength={NAME_MAX}
				autocomplete="nickname"
				autofocus
				required
			/>
			<span class="mt-1.5 flex justify-between text-xs text-paper/50">
				<span>A new name shows from the next table you join.</span>
				<span class="tabular-nums">{draft.length}/{NAME_MAX}</span>
			</span>
		</label>
		{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}
		<div class="flex justify-end gap-3">
			<button type="button" class="btn-ghost" onclick={() => (player.editing = false)}
				>Cancel</button
			>
			<button type="submit" class="btn-brass" disabled={saving}
				>{saving ? 'Saving…' : 'Save'}</button
			>
		</div>
	</form>
</dialog>
