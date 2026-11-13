<script lang="ts">
	import { gameBySlug } from '#lib/games/catalog.ts';
	import { when } from '#lib/when.ts';
	import type { PageProps } from './$types';

	/** The player's finished matches, newest first. Each opens its rounds and a check of every shuffle. */
	let { data }: PageProps = $props();

	// Dates are written in the viewer's own zone, so only once the page runs in the browser.
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
	});

	/** 1st, 2nd, 3rd, 4th… 11th, 12th, 13th. */
	const ordinal = (place: number) => {
		const lastTwo = place % 100;
		if (lastTwo >= 11 && lastTwo <= 13) {
			return `${place}th`;
		}

		const suffix = ['th', 'st', 'nd', 'rd'].at(place % 10) ?? 'th';

		return `${place}${suffix}`;
	};
</script>

<svelte:head><title>History · BlueClouds Games</title></svelte:head>

<section class="mx-auto max-w-2xl pt-10 md:pt-16">
	<h1 class="font-display text-4xl leading-tight font-black">Match history</h1>
	<p class="mt-2 text-sm text-paper/75">Your finished matches. Open one to check every round.</p>

	{#if data.matches.length === 0}
		<p class="mt-8 rounded-xl border border-paper/15 bg-panel p-6 text-sm text-paper/75">
			No finished matches yet.
		</p>
	{:else}
		<ul class="mt-8 divide-y divide-paper/10 rounded-xl border border-paper/15 bg-panel">
			{#each data.matches as match (match.id)}
				<li>
					<a
						href="/history/{match.id}"
						class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 hover:bg-paper/5 focus:bg-paper/5 focus:outline-none"
					>
						<span class="min-w-0 flex-1">
							<span class="block font-semibold text-paper">
								{gameBySlug(match.game)?.name ?? match.game}
							</span>
							<time class="block text-xs text-paper/55" datetime={match.endedAt}>
								{mounted ? when(match.endedAt) : ''}
							</time>
						</span>
						<span class="text-sm text-paper/75">
							{#if match.endReason === 'terminated'}
								Stopped by an admin
							{:else}
								{ordinal(match.placement)} of {match.players}
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.nextCursor}
		<p class="mt-4 text-center">
			<a class="btn-ghost px-4" href="?cursor={data.nextCursor}">Older matches</a>
		</p>
	{/if}
</section>
