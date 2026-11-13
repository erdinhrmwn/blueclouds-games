<script lang="ts">
	import { enterTable } from '#lib/tables.ts';

	/** Joining a friend's table by its code. */
	let { game }: { game: string } = $props();

	let code = $state('');
	let error = $state<string | null>(null);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		error = enterTable(game, code.trim().toUpperCase());
	}
</script>

<form class="w-full" onsubmit={submit} aria-label="Join a table by its code">
	<div
		class="flex h-12 items-center rounded-xl border border-paper/20 bg-black/30 pr-1.5 pl-4 focus-within:border-brass"
	>
		<label class="sr-only" for="table-code-{game}">Table code</label>
		<input
			id="table-code-{game}"
			class="min-w-0 flex-1 bg-transparent text-paper uppercase placeholder:text-paper/45 placeholder:normal-case focus:outline-none"
			bind:value={code}
			placeholder="Table code"
			maxlength="8"
			autocomplete="off"
			autocapitalize="characters"
			required
		/>
		<button
			class="h-9 rounded-lg bg-paper/12 px-4 text-sm font-semibold text-paper hover:bg-paper/20"
			type="submit">Join</button
		>
	</div>
	{#if error}<p class="mt-1.5 text-sm text-ember" role="alert">{error}</p>{/if}
</form>
