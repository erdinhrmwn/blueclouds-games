<script lang="ts">
	import { NAME_MAX, player, setPlayerName } from '#lib/player.svelte.ts';

	// First visit: the dialog can't be dismissed until there is a name.
	// Changing an existing name later can be cancelled.
	let dialog = $state<HTMLDialogElement>();
	let draft = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);
	const open = $derived(player.ready && (!player.name || player.editing));
	const required = $derived(!player.name);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			draft = player.name;
			error = null;
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (saving) return;
		saving = true;
		error = await setPlayerName(draft);
		saving = false;
	}

	function cancel(e: Event) {
		e.preventDefault(); // Esc: keep the dialog unless there is already a name
		if (!required) player.editing = false;
	}
</script>

<dialog
	bind:this={dialog}
	oncancel={cancel}
	aria-labelledby="name-title"
	class="m-auto w-[min(26rem,calc(100%-2rem))] rounded-xl border border-paper/15 bg-[#1b1611] p-6 text-paper backdrop:bg-black/70"
>
	<form onsubmit={submit} class="space-y-4">
		<h2 id="name-title" class="font-display text-2xl font-bold">{required ? 'What should we call you?' : 'Change your name'}</h2>
		<p class="text-sm text-paper/75">Other players see this name at the table. You can change it later.</p>
		<label class="block">
			<span class="label mb-1.5 block">Your name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="field" bind:value={draft} maxlength={NAME_MAX} autocomplete="nickname" placeholder="e.g. Rina" autofocus required />
		</label>
		{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}
		<div class="flex justify-end gap-3">
			{#if !required}
				<button type="button" class="btn-ghost" onclick={() => (player.editing = false)}>Cancel</button>
			{/if}
			<button type="submit" class="btn-brass" disabled={saving}>{saving ? 'Saving…' : required ? 'Continue' : 'Save'}</button>
		</div>
	</form>
</dialog>
