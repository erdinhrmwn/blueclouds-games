<script lang="ts">
	import { confirmState } from '#lib/confirm.svelte.ts';

	/** Shows the question asked through ask() in confirm.svelte.ts. Escape or Cancel answers "no". */
	let dialog = $state<HTMLDialogElement>();
	const question = $derived(confirmState.current);

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (question && !dialog.open) {
			dialog.showModal();
		}

		if (!question && dialog.open) {
			dialog.close();
		}
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => confirmState.current?.answer(false)}
	aria-labelledby="confirm-title"
	aria-describedby="confirm-body"
	class="modal"
>
	{#if question}
		<h2 id="confirm-title" class="modal-title">{question.title}</h2>
		{#if question.rows}
			<dl class="mt-4 divide-y divide-paper/8 rounded-xl bg-black/30 px-4 py-1 text-sm">
				{#each question.rows as row (row.label)}
					<div class="flex justify-between gap-4 py-2.5">
						<dt class={row.strong ? 'font-bold' : 'text-paper/70'}>{row.label}</dt>
						<dd class="font-extrabold tabular-nums {row.strong ? 'text-brass' : ''}">
							{row.value}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
		<p id="confirm-body" class="mt-3 text-sm leading-relaxed text-paper/75">{question.body}</p>
		<div class="mt-6 flex justify-end gap-3">
			<button class="btn-ghost" onclick={() => question.answer(false)}>
				{question.keep ?? 'Cancel'}
			</button>
			<button
				class={question.tone === 'brass' ? 'btn-brass' : 'btn-danger'}
				onclick={() => question.answer(true)}>{question.action}</button
			>
		</div>
	{/if}
</dialog>
