/**
 * The site's own "are you sure?" dialog, in place of the browser's confirm(): one question at a time,
 * answered by ConfirmDialog.svelte (mounted once in the root layout).
 */
export type Question = {
	title: string;
	body: string;
	/** The button that does it ("Kick", "Withdraw"); a danger button unless `tone` says otherwise. */
	action: string;
	/** "brass" for an action that spends rather than removes (joining with a fee). */
	tone?: 'danger' | 'brass';
	/** Figures to weigh before answering, shown as a small table ("Fee 100", "Your coins 1,250"). */
	rows?: { label: string; value: string; strong?: boolean }[];
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
