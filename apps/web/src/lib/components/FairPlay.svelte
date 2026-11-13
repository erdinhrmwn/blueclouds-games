<script lang="ts">
	import type { BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';

	/**
	 * Provably fair shuffles: a button in the table's header opens a dialog with the seeds of the match being
	 * played, each with a copy button (docs/architecture/fairness.md).
	 */
	let { room }: { room: RoomConnection<BaseView, unknown> } = $props();

	/** How long a field shows its "copied" tick. */
	const COPIED_MS = 1500;

	let dialog = $state<HTMLDialogElement>();
	let copied = $state<string | null>(null);

	const fairness = $derived(room.view?.fairness ?? null);

	const fields = $derived(
		fairness
			? [
					{ id: 'server-seed', label: 'Server seed (hashed)', value: fairness.serverSeedHash },
					{ id: 'client-seed', label: 'Client seed', value: fairness.clientSeed }
				]
			: []
	);

	async function copy(id: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			// The browser blocked the clipboard: select the text so it can be copied by hand.
			const box = document.getElementById(id);
			if (box) {
				window.getSelection()?.selectAllChildren(box);
			}

			return;
		}

		copied = id;
		setTimeout(() => {
			if (copied === id) {
				copied = null;
			}
		}, COPIED_MS);
	}
</script>

{#if fairness}
	<button
		class="btn-ghost size-10 shrink-0 p-0 sm:size-11"
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
		<p class="mt-2 text-xs text-paper/55">
			The deck is shuffled with HMAC-SHA256(server seed, client seed). The server seed is revealed
			when the match ends.
		</p>

		<div class="mt-5 space-y-4">
			{#each fields as field (field.id)}
				<div>
					<p class="label mb-1.5" id="{field.id}-label">{field.label}</p>
					<div class="flex items-stretch gap-2">
						<output
							id={field.id}
							aria-labelledby="{field.id}-label"
							class="min-w-0 flex-1 rounded-lg border border-paper/10 bg-black/30 px-3 py-2 font-mono text-xs break-all text-paper"
						>
							{field.value}
						</output>
						<button
							class="btn-ghost size-10 shrink-0 p-0"
							onclick={() => copy(field.id, field.value)}
							aria-label="Copy {field.label.toLowerCase()}"
							title="Copy"
						>
							{#if copied === field.id}
								<!-- A tick: copied. -->
								<svg
									viewBox="0 0 20 20"
									class="size-4 text-brass"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="m4.5 10.5 3.5 3.5 7.5-8" />
								</svg>
							{:else}
								<!-- Two sheets: copy. -->
								<svg
									viewBox="0 0 20 20"
									class="size-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<rect x="7" y="7" width="10" height="10" rx="2" />
									<path
										d="M13 4.5V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 3 4v7a1.5 1.5 0 0 0 1.5 1.5H5"
									/>
								</svg>
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>

		<p class="sr-only" aria-live="polite">{copied ? 'Copied.' : ''}</p>

		<div class="mt-6 flex justify-end">
			<button class="btn-brass" onclick={() => dialog?.close()}>Close</button>
		</div>
	</dialog>
{/if}
