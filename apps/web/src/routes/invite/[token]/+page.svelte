<script lang="ts">
	/** Only shown when an invite link doesn't work; a working one goes straight to its table. */
	let { data } = $props();
</script>

<svelte:head><title>Invite · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-md pt-24 text-center">
	<h1 class="font-display text-2xl font-bold">This invite doesn't work</h1>
	<p class="mt-3 text-paper/75" role="alert">{data.problem}</p>
	<p class="mt-6"><a class="btn-ghost" href="/">Back to the games</a></p>
</section>
