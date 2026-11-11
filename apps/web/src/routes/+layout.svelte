<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>BlueClouds Games</title>
</svelte:head>

<header class="mx-auto flex max-w-4xl items-baseline justify-between px-4 pt-5">
	<a href="/" class="inline-flex min-h-11 items-center gap-1.5 font-display text-xl font-black tracking-tight">BlueClouds <span class="text-brass">Games</span></a>
</header>

<main class="mx-auto max-w-4xl px-4 pb-12">
	{@render children()}
</main>
