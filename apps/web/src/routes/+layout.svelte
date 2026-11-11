<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import NameGate from '#lib/components/NameGate.svelte';
	import { WELCOME } from '#lib/guest.ts';
	import { loadPlayer, logOut, player } from '#lib/player.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	// The server's answer is the truth, refreshed on every navigation. Module state is shared between
	// requests on the server, so it is only filled in the browser (effects don't run there).
	$effect(() => loadPlayer(data.me));

	let outError = $state<string | null>(null);
	async function signOut() {
		// A guest only exists in this browser: logging out loses it for good.
		if (player.guest && !confirm('You are playing as a guest. Logging out ends this guest for good, including its game history. Link an account on your profile to keep it. Log out anyway?')) return;
		outError = await logOut();
		if (!outError) await goto(WELCOME, { invalidateAll: true });
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>BlueClouds Games</title>
</svelte:head>

{#if !player.playing}
	<header class="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 pt-5 sm:gap-3">
		<a href="/" class="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-display text-lg font-black tracking-tight sm:text-xl">BlueClouds <span class="text-brass">Games</span></a>
		{#if player.ready && player.name}
			<div class="flex min-w-0 items-center text-sm sm:gap-1">
				<!-- Your name goes to your profile; a guest is marked as one, so it's clear nothing is saved to an account yet. -->
				<a
					href="/profile"
					class="inline-flex min-h-11 min-w-0 flex-col items-start justify-center rounded-md px-1.5 leading-tight hover:bg-paper/5 sm:px-2"
					aria-label="Your profile: {player.name}{player.guest ? ', guest' : ''}"
				>
					<span class="max-w-full truncate font-semibold">{player.name}</span>
					{#if player.guest}
						<span class="text-[11px] text-paper/75">Guest</span>
					{:else}
						<span class="hidden max-w-full truncate text-[11px] text-paper/75 sm:block">@{player.username}</span>
					{/if}
				</a>
				<!-- Phones get an icon so a "Guest 482193" name fits beside it. -->
				<button class="link-btn min-w-11 shrink-0 justify-center" onclick={signOut} aria-label="Log out" title="Log out">
					<svg viewBox="0 0 20 20" class="size-5 sm:hidden" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 14l4-4-4-4M17 10H8" />
					</svg>
					<span class="hidden sm:inline">Log out</span>
				</button>
			</div>
		{/if}
	</header>
{/if}

<NameGate />

{#if outError}<p class="mx-auto max-w-4xl px-4 pt-2 text-right text-sm text-ember" role="alert">{outError}</p>{/if}

<main class="mx-auto max-w-4xl px-4 pb-12">
	{@render children()}
</main>
