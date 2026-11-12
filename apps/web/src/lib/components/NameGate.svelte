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
		} else if (!player.editing && dialog.open) dialog.close();
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
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
	class="m-auto w-[min(26rem,calc(100%-2rem))] rounded-xl border border-paper/15 bg-[#1b1611] p-6 text-paper backdrop:bg-black/70"
>
	<form onsubmit={submit} class="space-y-4">
		<h2 id="name-title" class="font-display text-2xl font-bold">Change your name</h2>
		<p class="text-sm text-paper/75">
			Other players see this name at the table. A new name shows from the next table you join.
		</p>
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
