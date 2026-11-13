<script lang="ts">
	import { ask } from '#lib/confirm.svelte.ts';
	import { goto } from '$app/navigation';
	import { WELCOME } from '#lib/guest.ts';
	import { logOut, player } from '#lib/player.svelte.ts';

	/** The header's account menu: your name opens it, with Profile and Log out inside. */
	let { onError }: { onError: (message: string | null) => void } = $props();

	const GUEST_LOGOUT_WARNING =
		'Logging out ends this guest for good, including its game history. Make an account on your profile to keep it.';

	let open = $state(false);
	let root = $state<HTMLDivElement>();
	let trigger = $state<HTMLButtonElement>();
	let menu = $state<HTMLDivElement>();

	const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

	function toggle() {
		open = !open;
	}

	function close(refocus: boolean) {
		open = false;
		if (refocus) trigger?.focus();
	}

	// The first item takes focus when the menu opens, so the keyboard can go straight on.
	$effect(() => {
		if (open) items()[0]?.focus();
	});

	// A click anywhere else closes it.
	$effect(() => {
		if (!open) return;

		const outside = (event: PointerEvent) => {
			if (!root?.contains(event.target as Node)) close(false);
		};
		document.addEventListener('pointerdown', outside);

		return () => document.removeEventListener('pointerdown', outside);
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close(true);
			return;
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

		event.preventDefault();
		const all = items();
		const at = all.indexOf(document.activeElement as HTMLElement);
		const step = event.key === 'ArrowDown' ? 1 : -1;
		all[(at + step + all.length) % all.length]?.focus();
	}

	async function signOut() {
		close(false);
		// A guest only exists in this browser: logging out loses it for good.
		if (player.guest) {
			const sure = await ask({
				title: 'Log out as a guest?',
				body: GUEST_LOGOUT_WARNING,
				action: 'Log out',
				keep: 'Keep playing'
			});
			if (!sure) return;
		}

		const error = await logOut();
		onError(error);
		if (!error) await goto(WELCOME, { invalidateAll: true });
	}
</script>

<div class="relative min-w-0" bind:this={root}>
	<button
		bind:this={trigger}
		class="pill inline-flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full p-1 text-left text-sm leading-tight hover:bg-paper/5 sm:pr-3"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="account-menu"
		aria-label="Account: {player.name}{player.guest ? ', guest' : ''}"
		onclick={toggle}
		onkeydown={(event) => {
			if (event.key === 'ArrowDown' && !open) {
				event.preventDefault();
				open = true;
			}
		}}
	>
		<!-- The pill hugs its content: the avatar always, the name and a Guest mark from tablet width up. -->
		<span
			class="grid size-8 shrink-0 place-items-center rounded-full bg-brass font-display text-sm font-bold text-ink"
			aria-hidden="true">{player.name.trim().charAt(0).toUpperCase()}</span
		>
		<span class="hidden min-w-0 items-baseline gap-1.5 sm:flex" aria-hidden="true">
			<span class="max-w-32 truncate font-semibold">{player.name}</span>
			{#if player.guest}<span class="text-[11px] text-paper/60">Guest</span>{/if}
		</span>
		<svg
			viewBox="0 0 20 20"
			class="size-4 shrink-0 text-paper/70 transition-transform max-sm:hidden motion-reduce:transition-none {open
				? 'rotate-180'
				: ''}"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="m5 8 5 5 5-5" />
		</svg>
	</button>

	{#if open}
		<div
			bind:this={menu}
			id="account-menu"
			role="menu"
			tabindex="-1"
			aria-label="Account"
			class="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border border-paper/15 bg-[#1b1611] py-1 shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
			onkeydown={onKeydown}
		>
			<a
				href="/profile"
				role="menuitem"
				class="flex min-h-11 items-center gap-2.5 px-3 text-sm hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
				onclick={() => close(false)}
			>
				<svg
					viewBox="0 0 20 20"
					class="size-4 text-paper/70"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="10" cy="7" r="3" />
					<path d="M4 16.5c.8-2.9 3.2-4.5 6-4.5s5.2 1.6 6 4.5" />
				</svg>
				Profile
			</a>
			<a
				href="/history"
				role="menuitem"
				class="flex min-h-11 items-center gap-2.5 px-3 text-sm hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
				onclick={() => close(false)}
			>
				<!-- A clock: past matches. -->
				<svg
					viewBox="0 0 20 20"
					class="size-4 text-paper/70"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="10" cy="10" r="6.5" />
					<path d="M10 6.5V10l2.5 1.5" />
				</svg>
				Match history
			</a>
			<button
				role="menuitem"
				class="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
				onclick={signOut}
			>
				<svg
					viewBox="0 0 20 20"
					class="size-4 text-paper/70"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 14l4-4-4-4M17 10H8" />
				</svg>
				Log out
			</button>
		</div>
	{/if}
</div>

<style>
	.pill {
		background: rgb(0 0 0 / 0.3);
		box-shadow: inset 0 0 0 1px rgb(243 234 214 / 0.16);
	}
</style>
