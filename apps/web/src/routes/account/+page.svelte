<script lang="ts">
	import { logOut, player } from '#lib/player.svelte.ts';

	/** The signed-in player's account; a guest is pointed at logging in or signing up. */
	let outError = $state<string | null>(null);
	let busy = $state(false);

	async function signOut() {
		busy = true;
		outError = await logOut();
		busy = false;
	}
</script>

<svelte:head><title>Account · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-md pt-10 md:pt-16">
	<h1 class="font-display text-4xl leading-tight font-black">Your account</h1>

	{#if !player.ready}
		<p class="mt-6 text-paper/75">Loading…</p>
	{:else if player.username}
		<div class="mt-6 rounded-xl border border-paper/15 bg-[#1b1611] p-6">
			<p>Logged in as <b class="font-semibold">{player.name}</b> <span class="text-paper/75">(@{player.username})</span>.</p>
			<p class="mt-2 text-sm text-paper/75">Your games are saved to this account. Log in with the same username on another device to keep playing there.</p>
			<div class="mt-5 flex flex-wrap gap-3">
				<a class="btn-brass" href="/">Back to the games</a>
				<button class="btn-ghost" onclick={signOut} disabled={busy}>Log out</button>
			</div>
			{#if outError}<p class="mt-3 text-sm text-ember" role="alert">{outError}</p>{/if}
		</div>
	{:else}
		<div class="mt-6 rounded-xl border border-paper/15 bg-[#1b1611] p-6">
			<p>
				{#if player.name}You're playing as <b class="font-semibold">{player.name}</b>, a guest.{:else}You're not logged in.{/if}
			</p>
			<p class="mt-2 text-sm text-paper/75">A guest only lives in this browser. Sign up to keep your games and play from any device.</p>
			<div class="mt-5 flex flex-wrap gap-3">
				<a class="btn-brass" href="/signup">Sign up</a>
				<a class="btn-ghost" href="/login">Log in</a>
			</div>
		</div>
	{/if}
</section>
