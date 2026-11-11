<script lang="ts">
	import { enterTable, newTable } from '#lib/tables.ts';

	/** Open a new table, or join one with a code from a friend. */
	let { game }: { game: string } = $props();
	let code = $state('');
	let error = $state<string | null>(null);
	let opening = $state(false);

	async function open() {
		opening = true;
		error = await newTable(game);
		opening = false;
	}
</script>

<section class="rounded-xl border border-paper/15 bg-[#1b1611] p-6" aria-label="Join a table">
	<form class="space-y-3" onsubmit={(e) => (e.preventDefault(), open())}>
		<p class="label">Start a game and invite friends or bots.</p>
		<button class="btn-brass w-full" type="submit" disabled={opening}>{opening ? 'Opening…' : 'Open a new table'}</button>
	</form>

	<hr class="my-6 border-paper/15" />

	<form onsubmit={(e) => (e.preventDefault(), (error = enterTable(game, code.trim().toUpperCase())))}>
		<label class="label mb-1.5 block" for="code">Got a code from a friend?</label>
		<div class="flex gap-2">
			<input id="code" class="field font-mono tracking-[0.2em] uppercase" bind:value={code} maxlength="8" placeholder="CODE" autocomplete="off" />
			<button class="btn-ghost shrink-0" type="submit">Join table</button>
		</div>
	</form>

	{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}
</section>
