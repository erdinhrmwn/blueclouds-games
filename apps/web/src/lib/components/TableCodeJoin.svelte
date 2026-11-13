<script lang="ts">
	import { enterTable, enterTableByCode } from '#lib/tables.ts';

	/** Joining a friend's table by its code. Without a game (the landing page) the code finds its own. */
	let { game }: { game?: string } = $props();

	let code = $state('');
	let error = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();

		const typed = code.trim().toUpperCase();
		error = game ? enterTable(game, typed) : await enterTableByCode(typed);
	}
</script>

<form class="w-full" onsubmit={submit} aria-label="Join a table by its code">
	<div
		class="flex h-12 items-center rounded-xl border border-paper/20 bg-black/30 pr-1.5 pl-4 focus-within:border-brass"
	>
		<label class="sr-only" for="table-code-{game ?? 'any'}">Table code</label>
		<input
			id="table-code-{game ?? 'any'}"
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
