<script lang="ts">
	import type { Tournament } from '#lib/platform.ts';
	import { FORMATS } from '#lib/tournament-formats.ts';
	import { when } from '#lib/when.ts';
	import PrizeFee from './PrizeFee.svelte';
	import SignUpBar from './SignUpBar.svelte';
	import TournamentFelt from './TournamentFelt.svelte';

	/** A tournament's Detail: the same felt as its card, then what it is, every fact, and Join or Leave. */
	let {
		open = $bindable(false),
		tournament,
		status,
		back,
		full,
		action,
		onaction
	}: {
		open?: boolean;
		tournament: Tournament | null;
		status: { label: string; dot: string };
		back: string;
		full: boolean;
		/** Join or Leave, as the card shows it. */
		action: { label: string; style: string; disabled: boolean };
		onaction: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;

		if (open && !dialog.open) {
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	const format = $derived(tournament?.format ? FORMATS[tournament.format] : null);
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="tournament-title"
	class="modal overflow-hidden p-0"
>
	{#if tournament}
		<TournamentFelt label={status.label} dot={status.dot} startsAt={tournament.startsAt} {back}>
			<button
				type="button"
				class="grid size-9 place-items-center rounded-lg bg-room/85 text-paper ring-1 ring-paper/15 hover:ring-paper/40"
				onclick={() => (open = false)}
				aria-label="Close"
			>
				<svg
					viewBox="0 0 20 20"
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M5 5l10 10M15 5 5 15" />
				</svg>
			</button>
		</TournamentFelt>

		<div class="space-y-5 p-6">
			<div>
				<h2 id="tournament-title" class="modal-title">{tournament.name}</h2>
				{#if format}
					<p class="mt-2 flex items-center gap-2 text-sm text-paper/60">
						<span
							class="rounded-md border border-brass/55 px-1.5 py-0.5 text-xs font-bold text-brass"
							>{format.label}</span
						>
						{format.note}
					</p>
				{/if}
				{#if tournament.description}
					<p class="mt-3 text-sm leading-relaxed whitespace-pre-line text-paper/80">
						{tournament.description}
					</p>
				{/if}
			</div>

			<PrizeFee prize={tournament.prize} fee={tournament.fee} />

			<dl class="divide-y divide-paper/8 text-sm">
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-paper/55">Starts</dt>
					<dd class="text-right font-semibold">{when(tournament.startsAt)}</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-paper/55">Sign-up closes</dt>
					<dd class="text-right font-semibold">{when(tournament.registrationClosesAt)}</dd>
				</div>
				<div class="flex justify-between gap-4 py-2">
					<dt class="text-paper/55">Per table</dt>
					<dd class="text-right font-semibold">{tournament.playersPerRoom} players</dd>
				</div>
				{#if tournament.minPlayers !== null}
					<div class="flex justify-between gap-4 py-2">
						<dt class="text-paper/55">Players</dt>
						<dd class="text-right font-semibold">
							{tournament.minPlayers}–{tournament.maxPlayers}, cancelled below {tournament.minPlayers}
						</dd>
					</div>
				{/if}
			</dl>

			<div>
				<SignUpBar
					registered={tournament.registered}
					minPlayers={tournament.minPlayers}
					maxPlayers={tournament.maxPlayers}
					joined={tournament.joined}
					{full}
				/>
			</div>

			<button
				class="{action.style} h-12 w-full rounded-xl text-base"
				onclick={onaction}
				disabled={action.disabled}
			>
				{action.label}
			</button>
		</div>
	{/if}
	<!-- The dialog's brass edge, drawn over the felt so the felt doesn't hide it. -->
	<div
		class="frame pointer-events-none absolute inset-0 rounded-[inherit]"
		aria-hidden="true"
	></div>
</dialog>

<style>
	.frame {
		box-shadow: inset 0 0 0 1.5px var(--color-brass);
	}
</style>
