<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import AccountMenu from '#lib/components/AccountMenu.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import NameGate from '#lib/components/NameGate.svelte';
	import { loadPlayer, player } from '#lib/player.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	// The server's answer is the truth, refreshed on every navigation. Module state is shared between
	// requests on the server, so it is only filled in the browser (effects don't run there).
	$effect(() => loadPlayer(data.me));

	let outError = $state<string | null>(null);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>BlueClouds Games</title>
</svelte:head>

{#if !player.playing}
	<header class="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 pt-5 sm:gap-3">
		<a
			href="/"
			class="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-display text-lg font-black tracking-tight sm:text-xl"
			>BlueClouds <span class="text-brass">Games</span></a
		>
		{#if player.ready && player.name}
			<AccountMenu onError={(message) => (outError = message)} />
		{/if}
	</header>
{/if}

<NameGate />
<ConfirmDialog />

{#if outError}<p class="mx-auto max-w-4xl px-4 pt-2 text-right text-sm text-ember" role="alert">
		{outError}
	</p>{/if}

<main class="mx-auto max-w-4xl px-4 pb-12">
	{@render children()}
</main>
