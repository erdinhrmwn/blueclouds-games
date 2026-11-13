/**
 * The site's own "are you sure?" dialog, in place of the browser's confirm(): one question at a time,
 * answered by ConfirmDialog.svelte (mounted once in the root layout).
 */
export type Question = {
	title: string;
	body: string;
	/** The button that does it ("Kick", "Withdraw"); drawn as a danger button. */
	action: string;
	/** The button that keeps things as they are. */
	keep?: string;
};

type Pending = Question & { answer: (yes: boolean) => void };

export const confirmState = $state<{ current: Pending | null }>({ current: null });

/** Asks the question and resolves true when the action is chosen, false when it is not. */
export function ask(question: Question): Promise<boolean> {
	// A question still open is answered "no" before the next one replaces it.
	confirmState.current?.answer(false);

	return new Promise((resolve) => {
		confirmState.current = {
			...question,
			answer: (yes) => {
				confirmState.current = null;
				resolve(yes);
			}
		};
	});
}
