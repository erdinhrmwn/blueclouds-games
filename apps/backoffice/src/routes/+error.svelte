<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/PageHeader.svelte';

	const title = $derived(page.status === 404 ? 'Not found' : 'Something went wrong');
</script>

<svelte:head><title>{title} · Backoffice</title></svelte:head>

<PageHeader {title} description={page.error?.message} />

<a class="btn-quiet" href="/">Back to the overview</a>
