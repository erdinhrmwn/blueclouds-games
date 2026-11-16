<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import { GAMES } from '#lib/games/catalog.ts';
	import type { Visibility } from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import { newTable } from '#lib/tables.ts';

	/**
	 * Opening a table: which game, its name and who may join. The opener becomes its host. `game` is picked when the
	 * dialog opens (the first game when left out); `paused` lists the games under maintenance, which open no tables.
	 */
	let {
		open = $bindable(false),
		game = null,
		paused = {}
	}: { open?: boolean; game?: string | null; paused?: Record<string, boolean> } = $props();

	const NAME_MAX = 32;

	let dialog = $state<HTMLDialogElement>();
	let chosen = $state(GAMES[0]!.slug);
	let name = $state('');
	let visibility = $state<Visibility>('public');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const chosenGame = $derived(GAMES.find((entry) => entry.slug === chosen) ?? GAMES[0]!);
	const maintenance = $derived(paused[chosen] ?? false);

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (open && !dialog.open) {
			chosen = game ?? GAMES[0]!.slug;
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
		error = await newTable(chosen, visibility, name.trim());
		busy = false;
	}

	const OPTIONS: { value: Visibility; title: string; body: string }[] = [
		{ value: 'public', title: 'Public', body: 'Listed in Open tables.' },
		{ value: 'private', title: 'Private', body: 'Only with the link or code.' }
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
				<p class="mt-1 text-sm text-paper/60">You’ll be the host</p>
			</div>
			<button
				type="button"
				class="btn-ghost size-9 shrink-0 p-0"
				onclick={() => (open = false)}
				aria-label="Close"
			>
				<Icon name="close" class="size-4" />
			</button>
		</div>

		<fieldset>
			<legend class="label mb-1.5">Game</legend>
			<div class="space-y-2">
				{#each GAMES as entry (entry.slug)}
					{@const picked = chosen === entry.slug}
					<label
						class="flex cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3 transition {picked
							? 'border-brass bg-black/35'
							: 'border-paper/18 bg-black/20 hover:border-paper/40'}"
					>
						<entry.Emblem small class="size-10 shrink-0" />
						<span class="min-w-0 flex-1">
							<span class="block font-semibold text-paper">{entry.name}</span>
							<span class="block text-xs text-paper/60">
								{entry.kind.charAt(0).toUpperCase()}{entry.kind.slice(1)} · {entry.minPlayers}–{entry.maxPlayers}
								players
							</span>
						</span>
						<input
							type="radio"
							class="size-4 shrink-0 accent-brass"
							bind:group={chosen}
							value={entry.slug}
						/>
					</label>
				{/each}
			</div>
		</fieldset>

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
			<div class="grid grid-cols-2 gap-3">
				{#each OPTIONS as option (option.value)}
					{@const picked = visibility === option.value}
					<label
						class="relative flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition {picked
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
				{chosenGame.name} is under maintenance. New tables are paused for now; tables already running
				play on.
			</p>
		{/if}
		{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}

		<div class="flex justify-end gap-3">
			<button type="button" class="btn-ghost" onclick={() => (open = false)}>Cancel</button>
			<button type="submit" class="btn-brass" disabled={busy || maintenance}
				>{busy ? 'Opening…' : `Open ${chosenGame.name} table`}</button
			>
		</div>
	</form>
</dialog>
