<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import NameGate from '#lib/components/NameGate.svelte';
	import { loadPlayer, player } from '#lib/player.svelte.ts';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	onMount(loadPlayer);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>BlueClouds Games</title>
</svelte:head>

<header class="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 pt-5">
	<a href="/" class="inline-flex min-h-11 items-center gap-1.5 font-display text-xl font-black tracking-tight">BlueClouds <span class="text-brass">Games</span></a>
	{#if player.name}
		<p class="flex min-w-0 items-center text-sm text-paper/75">
			<span class="truncate">Playing as <b class="font-semibold text-paper">{player.name}</b></span>
			<button class="link-btn shrink-0" onclick={() => (player.editing = true)}>Change</button>
			<a class="link-btn shrink-0" href="/account">{player.username ? 'Account' : 'Sign in'}</a>
		</p>
	{/if}
</header>

<NameGate />

<main class="mx-auto max-w-4xl px-4 pb-12">
	{@render children()}
</main>
