<script lang="ts">
	import type { Visibility } from '#lib/platform.ts';
	import { joinWithInvite, newTable } from '#lib/tables.ts';

	/** Open a new table (private or public), or join a friend's with an invite code. */
	let { game }: { game: string } = $props();
	let visibility = $state<Visibility>('private');
	let code = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function run(task: () => Promise<string | null>) {
		busy = true;
		error = await task();
		busy = false;
	}
</script>

<section class="rounded-xl border border-paper/15 bg-[#1b1611] p-6" aria-label="Join a table">
	<form
		class="space-y-3"
		onsubmit={(e) => (e.preventDefault(), run(() => newTable(game, visibility)))}
	>
		<fieldset class="space-y-1">
			<legend class="label mb-1.5">Who can join?</legend>
			<label class="flex min-h-11 items-center gap-3">
				<input type="radio" class="size-4 accent-brass" bind:group={visibility} value="private" />
				<span>Only friends I invite</span>
			</label>
			<label class="flex min-h-11 items-center gap-3">
				<input type="radio" class="size-4 accent-brass" bind:group={visibility} value="public" />
				<span>Anyone, from Open tables</span>
			</label>
		</fieldset>
		<button class="btn-brass w-full" type="submit" disabled={busy}
			>{busy ? 'Please wait…' : 'Open a new table'}</button
		>
	</form>

	<hr class="my-6 border-paper/15" />

	<form onsubmit={(e) => (e.preventDefault(), run(() => joinWithInvite(code)))}>
		<label class="label mb-1.5 block" for="invite-code">Got an invite code from a friend?</label>
		<div class="flex gap-2">
			<input
				id="invite-code"
				class="field font-mono tracking-[0.2em] uppercase"
				bind:value={code}
				maxlength="6"
				placeholder="CODE"
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
			/>
			<button class="btn-ghost shrink-0" type="submit" disabled={busy}>Join table</button>
		</div>
	</form>

	{#if error}<p class="mt-3 text-sm text-ember" role="alert">{error}</p>{/if}
</section>
