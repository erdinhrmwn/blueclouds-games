<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import AccountMenu from '#lib/components/AccountMenu.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import NameGate from '#lib/components/NameGate.svelte';
	import { gameBySlug } from '#lib/games/catalog.ts';
	import { loadPlayer, player } from '#lib/player.svelte.ts';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	// The server's answer is the truth, refreshed on every navigation. Module state is shared between
	// requests on the server, so it is only filled in the browser (effects don't run there).
	$effect(() => loadPlayer(data.me));

	let outError = $state<string | null>(null);

	const NAV = [
		{ href: '/lobby', label: 'Lobby' },
		{ href: '/', label: 'Games' }
	];

	/** The nav item the page belongs to: the lobby, or the games (the home page and each game's own page). */
	const section = $derived.by(() => {
		const { pathname } = page.url;
		if (pathname.startsWith('/lobby')) {
			return '/lobby';
		}

		const firstSegment = pathname.split('/')[1] ?? '';
		if (pathname === '/' || gameBySlug(firstSegment)) {
			return '/';
		}

		return null;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>BlueClouds Games</title>
</svelte:head>

{#if !player.playing}
	<header class="mx-auto flex max-w-[62rem] items-center justify-between gap-2 px-4 pt-5 sm:gap-3">
		<div class="flex min-w-0 items-center gap-6">
			<a
				href="/"
				class="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-display text-base font-black tracking-tight"
				>BlueClouds <span class="text-brass">Games</span></a
			>
			{#if player.ready && player.name}
				<!-- Phones have no room for it beside the account pill; there the game pages lead to the lobby. -->
				<nav class="hidden items-center gap-1 text-sm font-semibold sm:flex" aria-label="Main">
					{#each NAV as item (item.href)}
						{@const current = section === item.href}
						<a
							href={item.href}
							class="rounded-full px-3.5 py-1.5 transition-colors {current
								? 'bg-paper/8 text-paper'
								: 'text-paper/60 hover:text-paper'}"
							aria-current={current ? 'page' : undefined}>{item.label}</a
						>
					{/each}
				</nav>
			{/if}
		</div>
		{#if player.ready && player.name}
			<AccountMenu onError={(message) => (outError = message)} />
		{/if}
	</header>
{/if}

<NameGate />
<ConfirmDialog />

{#if outError}<p class="mx-auto max-w-[62rem] px-4 pt-2 text-right text-sm text-ember" role="alert">
		{outError}
	</p>{/if}

<main class="mx-auto max-w-[62rem] px-4 pb-12">
	{@render children()}
</main>
