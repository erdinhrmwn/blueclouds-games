<script lang="ts">
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';

	/**
	 * Provably fair shuffles, below the table: the seed hash the deal is locked to before it starts, and a check
	 * of the last match's shuffles, run in this browser (docs/architecture/fairness.md).
	 */
	let { room }: { room: RoomConnection<BaseView, unknown> } = $props();

	const fairness = $derived(room.view?.fairness ?? null);

	type Result =
		{ matchId: string; ok: boolean; shuffles: number } | { matchId: string; error: string };
	let result = $state<Result | null>(null);
	let checking = $state(false);

	async function check() {
		checking = true;
		try {
			const checked = await room.checkLastMatch();
			if (checked) {
				result = {
					matchId: checked.proof.matchId,
					ok: checked.ok,
					shuffles: checked.shuffles.length
				};
			}
		} catch {
			result = {
				matchId: fairness?.revealed?.matchId ?? '',
				error: 'Could not load the last match.'
			};
		} finally {
			checking = false;
		}
	}

	// A result belongs to one match: a newer reveal clears it.
	const shown = $derived(result && result.matchId === fairness?.revealed?.matchId ? result : null);
</script>

{#if fairness}
	<details
		class="mx-auto mt-8 max-w-2xl rounded-lg border border-paper/10 px-4 py-3 text-xs text-paper/70"
	>
		<summary class="cursor-pointer font-semibold text-paper/85">Fair play</summary>
		<div class="mt-3 space-y-3">
			<p>
				Every deck is shuffled from a server seed that is locked in before the match starts. Its
				hash is shown here first; the seed itself is revealed when the match ends, so anyone can
				check every shuffle.
			</p>
			<dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
				<dt class="text-paper/50">{fairness.clientSeed ? 'This match' : 'Next match'}</dt>
				<dd class="font-mono break-all">{fairness.matchId}</dd>
				<dt class="text-paper/50">Server seed hash</dt>
				<dd class="font-mono break-all">{fairness.serverSeedHash}</dd>
				{#if fairness.clientSeed}
					<dt class="text-paper/50">Client seed</dt>
					<dd class="font-mono break-all">{fairness.clientSeed}</dd>
				{/if}
			</dl>

			{#if fairness.revealed}
				<div class="border-t border-paper/10 pt-3">
					<p class="font-semibold text-paper/85">Last match</p>
					<dl class="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
						<dt class="text-paper/50">Server seed</dt>
						<dd class="font-mono break-all">{fairness.revealed.serverSeed}</dd>
						<dt class="text-paper/50">Hash shown before</dt>
						<dd class="font-mono break-all">{fairness.revealed.serverSeedHash}</dd>
					</dl>
					<div class="mt-2 flex flex-wrap items-center gap-3">
						<button class="btn-ghost px-3 py-1 text-xs" onclick={check} disabled={checking}>
							{checking ? 'Checking…' : 'Verify last match'}
						</button>
						{#if shown && 'error' in shown}
							<span class="text-ember" role="alert">{shown.error}</span>
						{:else if shown}
							<span class={shown.ok ? 'text-brass' : 'text-ember'} role="status">
								{shown.ok
									? `Verified: all ${shown.shuffles} shuffles match the seed.`
									: 'These shuffles do not match the seed.'}
							</span>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</details>
{/if}
