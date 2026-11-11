<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const nav = [
		{ href: '/players', label: 'Players' },
		{ href: '/matches', label: 'Matches' },
		{ href: '/audit', label: 'Audit log' }
	];
	const current = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap" />
</svelte:head>

{#if data.admin}
	<header class="border-b border-line bg-surface">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
			<a href="/" class="min-h-11 content-center font-semibold">BlueClouds Backoffice</a>
			<nav aria-label="Main" class="flex gap-1">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						aria-current={current(item.href) ? 'page' : undefined}
						class="min-h-11 content-center rounded-md px-3 text-sm font-medium text-muted hover:bg-page hover:text-ink aria-[current=page]:text-felt aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8"
						>{item.label}</a
					>
				{/each}
			</nav>
			<div class="ml-auto flex items-center gap-3 text-sm text-muted">
				<span>Signed in as <b class="font-semibold text-ink">{data.admin.username}</b></span>
				<form method="POST" action="/logout">
					<button class="btn-quiet">Sign out</button>
				</form>
			</div>
		</div>
	</header>
{/if}

<main class="mx-auto max-w-6xl px-4 py-6">
	{@render children()}
</main>
