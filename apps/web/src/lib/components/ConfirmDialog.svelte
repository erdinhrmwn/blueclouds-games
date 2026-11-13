<script lang="ts">
	import { confirmState } from '#lib/confirm.svelte.ts';

	/** Shows the question asked through ask() in confirm.svelte.ts. Escape or Cancel answers "no". */
	let dialog = $state<HTMLDialogElement>();
	const question = $derived(confirmState.current);

	$effect(() => {
		if (!dialog) return;

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
		<p id="confirm-body" class="mt-2 text-sm leading-relaxed text-paper/75">{question.body}</p>
		<div class="mt-6 flex justify-end gap-3">
			<button class="btn-ghost" onclick={() => question.answer(false)}>
				{question.keep ?? 'Cancel'}
			</button>
			<button class="btn-danger" onclick={() => question.answer(true)}>{question.action}</button>
		</div>
	{/if}
</dialog>
