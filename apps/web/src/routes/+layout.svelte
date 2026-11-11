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

{#if !player.playing}
	<header class="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 pt-5 sm:gap-3">
		<a href="/" class="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-display text-lg font-black tracking-tight sm:text-xl">BlueClouds <span class="text-brass">Games</span></a>
		{#if player.name}
			<div class="flex min-w-0 items-center gap-1 text-sm">
				<!-- Your name is the button that renames you; a guest is marked as one, so it's clear nothing is saved to an account yet. -->
				<button
					class="inline-flex min-h-11 min-w-0 flex-col items-start justify-center rounded-md px-2 text-left leading-tight hover:bg-paper/5"
					onclick={() => (player.editing = true)}
					aria-label="{player.name}{player.username ? '' : ', guest'}. Change name"
					title="Change name"
				>
					<span class="flex max-w-full items-center gap-1">
						<span class="truncate font-semibold">{player.name}</span>
						<svg viewBox="0 0 16 16" class="size-3 shrink-0 text-paper/60" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M10.5 2.5l3 3L6 13H3v-3z" />
						</svg>
					</span>
					{#if player.username}
						<span class="hidden max-w-full truncate text-[11px] text-paper/75 sm:block">@{player.username}</span>
					{:else}
						<span class="text-[11px] text-paper/75">Guest</span>
					{/if}
				</button>
				<a class="link-btn shrink-0" href="/account">{player.username ? 'Account' : 'Sign in'}</a>
			</div>
		{/if}
	</header>
{/if}

<NameGate />

<main class="mx-auto max-w-4xl px-4 pb-12">
	{@render children()}
</main>
