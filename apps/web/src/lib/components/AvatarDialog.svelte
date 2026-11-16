<script lang="ts">
	import {
		AVATAR_COLORS,
		AVATAR_ICONS,
		type AvatarColor,
		type AvatarIcon,
		defaultAvatarColor
	} from 'server/games/shared/avatars';
	import { saveAvatar } from '#lib/platform.ts';
	import { player } from '#lib/player.svelte.ts';
	import Avatar, { AVATAR_TONES } from './Avatar.svelte';
	import AvatarGlyph from './AvatarGlyph.svelte';

	/** Picking a preset avatar: one of 12 colours and one of 16 icons, or the initial. No uploads. */
	let { open = $bindable(false) }: { open?: boolean } = $props();

	let dialog = $state<HTMLDialogElement>();
	let color = $state<AvatarColor>('rain');
	let icon = $state<AvatarIcon | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

	$effect(() => {
		if (!dialog) {
			return;
		}

		if (open && !dialog.open) {
			color = player.avatar.color ?? defaultAvatarColor(player.id);
			icon = player.avatar.icon;
			error = null;
			dialog.showModal();
		}

		if (!open && dialog.open) {
			dialog.close();
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) {
			return;
		}

		busy = true;
		error = null;

		try {
			const saved = await saveAvatar({ color, icon });
			player.avatar = saved.avatar;
			open = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="avatar-title"
	class="modal sm:w-[min(26rem,calc(100%-2rem))]"
>
	<form onsubmit={submit} class="space-y-6">
		<h2 id="avatar-title" class="modal-title">Your avatar</h2>

		<div class="flex flex-col items-center gap-2">
			<Avatar
				id={player.id}
				name={player.name}
				avatar={{ color, icon }}
				class="size-[5.5rem] rounded-[22px] text-4xl"
			/>
			<p class="text-sm font-medium text-paper/80">{player.name}</p>
		</div>

		<fieldset>
			<legend class="label mb-2.5">Colour</legend>
			<div class="grid grid-cols-6 gap-2.5">
				{#each AVATAR_COLORS as option (option)}
					<label
						class="relative grid aspect-square cursor-pointer rounded-xl ring-offset-2 ring-offset-panel has-checked:ring-2 has-checked:ring-brass has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-brass"
						style:background-color={AVATAR_TONES[option]}
						title={label(option)}
					>
						<input
							type="radio"
							name="avatar-color"
							value={option}
							bind:group={color}
							class="sr-only"
						/>
						<span class="sr-only">{label(option)}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<fieldset>
			<legend class="label mb-2.5">Icon</legend>
			<div class="grid grid-cols-6 gap-2.5">
				<label
					class="grid aspect-square cursor-pointer place-items-center rounded-xl border border-paper/15 bg-room font-display text-lg font-bold ring-offset-2 ring-offset-panel has-checked:ring-2 has-checked:ring-brass has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-brass"
					title="Your initial"
				>
					<input type="radio" name="avatar-icon" value={null} bind:group={icon} class="sr-only" />
					<span aria-hidden="true">{player.name.trim().charAt(0).toUpperCase()}</span>
					<span class="sr-only">Your initial</span>
				</label>
				{#each AVATAR_ICONS as option (option)}
					<label
						class="grid aspect-square cursor-pointer place-items-center rounded-xl text-paper ring-offset-2 ring-offset-panel has-checked:ring-2 has-checked:ring-brass has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-brass"
						style:background-color={AVATAR_TONES[color]}
						style:--avatar-tile={AVATAR_TONES[color]}
						title={label(option)}
					>
						<input
							type="radio"
							name="avatar-icon"
							value={option}
							bind:group={icon}
							class="sr-only"
						/>
						<svg viewBox="0 0 24 24" class="size-[62%]" aria-hidden="true">
							<AvatarGlyph icon={option} />
						</svg>
						<span class="sr-only">{label(option)}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if error}<p class="text-sm text-ember" role="alert">{error}</p>{/if}
		<div class="flex justify-end gap-3">
			<button type="button" class="btn-ghost" onclick={() => (open = false)}>Cancel</button>
			<button type="submit" class="btn-brass" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
</dialog>
