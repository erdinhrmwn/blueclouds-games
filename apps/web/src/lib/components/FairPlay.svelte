<script lang="ts">
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';

	/**
	 * Provably fair shuffles: a button in the table's header opens a dialog with the seed hash the deal is locked to
	 * before it starts, and a check of the last match's shuffles, run in this browser (docs/architecture/fairness.md).
	 */
	let { room }: { room: RoomConnection<BaseView, unknown> } = $props();

	let dialog = $state<HTMLDialogElement>();

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
	<button
		class="btn-ghost size-11 shrink-0 p-0"
		onclick={() => dialog?.showModal()}
		aria-haspopup="dialog"
		aria-label="Fair play"
		title="Fair play"
	>
		<!-- A shield with a tick: the deal can be checked. -->
		<svg
			viewBox="0 0 20 20"
			class="size-5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M10 2.5 4 5v4.5c0 3.8 2.6 6.9 6 8 3.4-1.1 6-4.2 6-8V5l-6-2.5Z" />
			<path d="m7.25 10 2 2 3.5-3.75" />
		</svg>
	</button>

	<dialog
		bind:this={dialog}
		aria-labelledby="fair-play-title"
		class="m-auto w-[min(34rem,calc(100%-2rem))] rounded-xl border border-paper/15 bg-[#1b1611] p-6 text-sm text-paper/75 backdrop:bg-black/70"
	>
		<h2 id="fair-play-title" class="font-display text-2xl font-bold text-paper">Fair play</h2>
		<div class="mt-3 space-y-4">
			<p>
				Every deck is shuffled from a server seed that is locked in before the match starts. Its
				hash is shown here first; the seed itself is revealed when the match ends, so anyone can
				check every shuffle.
			</p>
			<dl class="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
				<dt class="text-paper/55">{fairness.clientSeed ? 'This match' : 'Next match'}</dt>
				<dd class="font-mono break-all">{fairness.matchId}</dd>
				<dt class="text-paper/55">Server seed hash</dt>
				<dd class="font-mono break-all">{fairness.serverSeedHash}</dd>
				{#if fairness.clientSeed}
					<dt class="text-paper/55">Client seed</dt>
					<dd class="font-mono break-all">{fairness.clientSeed}</dd>
				{/if}
			</dl>

			{#if fairness.revealed}
				<div class="border-t border-paper/10 pt-4">
					<p class="font-semibold text-paper">Last match</p>
					<dl class="mt-1 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
						<dt class="text-paper/55">Server seed</dt>
						<dd class="font-mono break-all">{fairness.revealed.serverSeed}</dd>
						<dt class="text-paper/55">Hash shown before</dt>
						<dd class="font-mono break-all">{fairness.revealed.serverSeedHash}</dd>
					</dl>
					<div class="mt-3 flex flex-wrap items-center gap-3">
						<button class="btn-ghost px-4 text-xs" onclick={check} disabled={checking}>
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
			{:else}
				<p class="border-t border-paper/10 pt-4 text-xs text-paper/55">
					Once a match ends here, its seed shows up and you can verify it.
				</p>
			{/if}
		</div>
		<div class="mt-6 flex justify-end">
			<button class="btn-brass" onclick={() => dialog?.close()}>Close</button>
		</div>
	</dialog>
{/if}
