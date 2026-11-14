<script lang="ts">
	import type { Visibility } from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { newTable } from '#lib/tables.ts';

	/** Opening a table: its name and who may join. The opener becomes its host. */
	let {
		open = $bindable(false),
		game,
		gameName,
		maintenance = false
	}: { open?: boolean; game: string; gameName: string; maintenance?: boolean } = $props();

	const NAME_MAX = 32;

	let dialog = $state<HTMLDialogElement>();
	let name = $state('');
	let visibility = $state<Visibility>('public');
	let error = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (open && !dialog.open) {
			name = player.name ? `${player.name}’s table`.slice(0, NAME_MAX) : '';
			error = null;
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) {
			return;
		}

		busy = true;
		error = await newTable(game, visibility, name.trim());
		busy = false;
	}

	const OPTIONS: { value: Visibility; title: string; body: string }[] = [
		{ value: 'public', title: 'Public', body: 'Listed in Open tables. Anyone can sit.' },
		{ value: 'private', title: 'Private', body: 'Hidden. Only people with the link or code.' }
	];
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="open-table-title"
	class="modal"
>
	<form onsubmit={submit} class="space-y-5">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h2 id="open-table-title" class="modal-title">Open a table</h2>
				<p class="mt-1 text-sm text-paper/60">{gameName}, you’ll be the host</p>
			</div>
			<button
				type="button"
				class="btn-ghost size-9 shrink-0 p-0"
				onclick={() => (open = false)}
				aria-label="Close"
			>
				<svg
					viewBox="0 0 20 20"
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M5 5l10 10M15 5 5 15" />
				</svg>
			</button>
		</div>

		<label class="block">
			<span class="label mb-1.5 block">Table name</span>
			<input
				class="field"
				bind:value={name}
				maxlength={NAME_MAX}
				placeholder="{player.name || 'My'}’s table"
				autocomplete="off"
			/>
			<span class="mt-1.5 flex justify-between gap-3 text-xs text-paper/50">
				<span>Shown in the table list and at the top of the table.</span>
				<span class="tabular-nums">{name.length}/{NAME_MAX}</span>
			</span>
		</label>

		<fieldset>
			<legend class="label mb-1.5">Who can join</legend>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each OPTIONS as option (option.value)}
					{@const chosen = visibility === option.value}
					<label
						class="relative flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition {chosen
							? 'border-brass bg-black/35'
							: 'border-paper/18 bg-black/20 hover:border-paper/40'}"
					>
						<input
							type="radio"
							class="absolute top-4 right-4 size-4 accent-brass"
							bind:group={visibility}
							value={option.value}
						/>
						<span class="font-semibold text-paper">{option.title}</span>
						<span class="pr-6 text-xs text-paper/60">{option.body}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if maintenance}
			<p
				class="rounded-md border border-brass/40 bg-brass/10 px-3 py-2 text-sm text-brass"
				role="status"
			>
				Under maintenance. New tables are paused for now; tables already running play on.
			</p>
		{/if}
		{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}

		<div class="flex justify-end gap-3">
			<button type="button" class="btn-ghost" onclick={() => (open = false)}>Cancel</button>
			<button type="submit" class="btn-brass" disabled={busy || maintenance}
				>{busy ? 'Opening…' : 'Open table'}</button
			>
		</div>
	</form>
</dialog>
