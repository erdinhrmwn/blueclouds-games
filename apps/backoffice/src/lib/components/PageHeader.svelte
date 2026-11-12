<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		description?: string;
		/** The list page a detail page belongs to, shown as a breadcrumb above the title. */
		parent?: { href: string; label: string };
		/** Buttons or links on the right of the title. */
		actions?: Snippet;
	};

	let { title, description, parent, actions }: Props = $props();
</script>

<header class="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
	<div class="min-w-0">
		{#if parent}
			<nav aria-label="Breadcrumb" class="mb-1.5 text-sm text-muted">
				<a class="hover:text-ink hover:underline hover:underline-offset-2" href={parent.href}
					>{parent.label}</a
				>
				<span aria-hidden="true" class="mx-1.5">/</span>
				<span aria-current="page">{title}</span>
			</nav>
		{/if}
		<h1 class="text-2xl font-semibold tracking-tight break-words">{title}</h1>
		{#if description}
			<p class="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap gap-2">{@render actions()}</div>
	{/if}
</header>
