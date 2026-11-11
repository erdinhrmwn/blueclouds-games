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
		if (!player.username && !confirm('You are playing as a guest. Logging out ends this guest for good, including its game history. Link an account on your profile to keep it. Log out anyway?')) return;
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
			<div class="flex min-w-0 items-center gap-1 text-sm">
				<!-- Your name goes to your profile; a guest is marked as one, so it's clear nothing is saved to an account yet. -->
				<a
					href="/profile"
					class="inline-flex min-h-11 min-w-0 flex-col items-start justify-center rounded-md px-2 leading-tight hover:bg-paper/5"
					aria-label="Your profile: {player.name}{player.username ? '' : ', guest'}"
				>
					<span class="max-w-full truncate font-semibold">{player.name}</span>
					{#if player.username}
						<span class="hidden max-w-full truncate text-[11px] text-paper/75 sm:block">@{player.username}</span>
					{:else}
						<span class="text-[11px] text-paper/75">Guest</span>
					{/if}
				</a>
				<button class="link-btn shrink-0" onclick={signOut}>Log out</button>
			</div>
		{/if}
	</header>
{/if}

<NameGate />

{#if outError}<p class="mx-auto max-w-4xl px-4 pt-2 text-right text-sm text-ember" role="alert">{outError}</p>{/if}

<main class="mx-auto max-w-4xl px-4 pb-12">
	{@render children()}
</main>
