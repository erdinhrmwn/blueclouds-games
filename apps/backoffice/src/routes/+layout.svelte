<script lang="ts">
	import './layout.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
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
