<script lang="ts">
	/** A seed shown in full with a copy button: the Fair play dialog and a match's history page. */
	let { id, label, value }: { id: string; label: string; value: string } = $props();

	/** How long the button shows its "copied" tick. */
	const COPIED_MS = 1500;

	let copied = $state(false);

	async function copy() {
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

		copied = true;
		setTimeout(() => {
			copied = false;
		}, COPIED_MS);
	}
</script>

<div>
	<p class="label mb-1.5" id="{id}-label">{label}</p>
	<div class="flex items-stretch gap-2">
		<output
			{id}
			aria-labelledby="{id}-label"
			class="min-w-0 flex-1 rounded-lg border border-paper/10 bg-black/30 px-3 py-2 font-mono text-xs break-all text-paper"
		>
			{value}
		</output>
		<button
			class="btn-ghost size-10 shrink-0 p-0"
			onclick={copy}
			aria-label="Copy {label.toLowerCase()}"
			title="Copy"
		>
			{#if copied}
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
	<p class="sr-only" aria-live="polite">{copied ? 'Copied.' : ''}</p>
</div>
