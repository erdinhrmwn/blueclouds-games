<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { GAMES } from '#lib/games/catalog.ts';
	import { playLanding } from '#lib/landing-motion.ts';

	const fewestPlayers = Math.min(...GAMES.map((game) => game.minPlayers));
	const mostPlayers = Math.max(...GAMES.map((game) => game.maxPlayers));

	const STEPS = [
		{
			title: 'Open a table',
			text: 'Pick a game and open a table. You are the host, so you decide when it starts.'
		},
		{
			title: 'Send the invite link',
			text: 'Copy the table’s link from the lobby and send it. Friends join straight to a seat.'
		},
		{
			title: 'Fill the rest with bots',
			text: 'Short on players? Put a bot in any empty seat and deal the first hand.'
		}
	];

	/**
	 * Loose cards beside the hero. `depth` is how far a layer rises (px) while the hero scrolls away:
	 * the near layers move more than the far ones, which reads as depth.
	 * `turn` is the card's resting tilt.
	 */
	const BACKS = [
		{ id: 'far', top: '-2%', left: '76%', turn: 16, depth: 40 },
		{ id: 'low', top: '62%', left: '4%', turn: -12, depth: 70 }
	];
	const FANS = [
		{ top: '2%', left: '12%', turn: -9, depth: 130 },
		{ top: '46%', left: '26%', turn: 7, depth: 220 }
	];

	let page = $state<HTMLElement>();

	onMount(() => {
		if (!page || prefersReducedMotion.current) {
			return;
		}

		return playLanding(page);
	});
</script>

<div bind:this={page} class:still={prefersReducedMotion.current}>
	<section
		class="grid gap-10 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-16"
		aria-labelledby="hero-title"
		data-hero
	>
		<div data-hero-text>
			<p class="label mb-3" data-enter>Card games in your browser</p>
			<h1
				id="hero-title"
				data-enter
				class="font-display text-5xl leading-[0.95] font-black sm:text-6xl"
			>
				Pull up<br />a <span class="text-ember italic">chair.</span>
			</h1>
			<p class="mt-5 max-w-xl text-lg leading-relaxed text-paper/80" data-enter>
				Quick card games for {fewestPlayers} to {mostPlayers} players. Open a table, send your friends
				the link, and let bots take any seat that’s left.
			</p>
		</div>

		<!-- Phones skip the loose cards: the hero text needs the whole width there. -->
		<div class="relative hidden h-80 md:block" aria-hidden="true">
			{#each BACKS as back (back.id)}
				<div
					class="absolute"
					style="top: {back.top}; left: {back.left}; rotate: {back.turn}deg"
					data-depth={back.depth}
				>
					<div class="card-back h-28 w-20 opacity-80" data-deal></div>
				</div>
			{/each}

			{#each GAMES as game, index (game.slug)}
				{@const fan = FANS[index % FANS.length]}
				<div
					class="absolute"
					style="top: {fan.top}; left: {fan.left}; rotate: {fan.turn}deg"
					data-depth={fan.depth}
				>
					<div data-deal>
						<game.Fan />
					</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="mt-12 md:mt-16" aria-labelledby="games-title">
		<h2 id="games-title" class="sr-only">Games</h2>
		<ul class="grid gap-6 md:grid-cols-2">
			{#each GAMES as game (game.slug)}
				<li data-reveal>
					<a
						href="/{game.slug}"
						class="game group flex h-full flex-col overflow-hidden rounded-2xl border border-paper/15 bg-[#1b1611] transition-colors hover:border-brass/60"
						aria-label="Play {game.name}"
						aria-describedby="{game.slug}-tagline"
					>
						<div class="felt grid h-44 place-items-center sm:h-52">
							<div data-float>
								<div data-fan>
									<div class="fan">
										<game.Fan />
									</div>
								</div>
							</div>
						</div>

						<div class="flex flex-1 flex-col p-6 sm:p-7">
							<p class="label">
								<span class="inline-block first-letter:uppercase">{game.kind}</span> ·
								{game.minPlayers}–{game.maxPlayers} players
							</p>
							<h3 class="mt-2 font-display text-3xl font-bold">{game.name}</h3>
							<p id="{game.slug}-tagline" class="mt-3 leading-relaxed text-paper/80">
								{game.tagline}
							</p>

							<span class="btn-brass mt-6 self-start" aria-hidden="true">
								Play {game.name}
								<svg
									viewBox="0 0 20 20"
									class="size-4 transition-transform group-hover:translate-x-0.5"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M4 10h12M11 5l5 5-5 5" />
								</svg>
							</span>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<section class="mt-20" aria-labelledby="night-title">
		<h2 id="night-title" class="font-display text-2xl font-bold sm:text-3xl">
			How a game night works
		</h2>
		<ol class="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6" data-steps>
			{#each STEPS as step, index (step.title)}
				<li class="border-t border-paper/15 pt-5" data-step>
					<span class="font-mono text-sm text-brass">0{index + 1}</span>
					<h3 class="mt-2 text-lg font-semibold">{step.title}</h3>
					<p class="mt-2 leading-relaxed text-paper/75">{step.text}</p>
				</li>
			{/each}
		</ol>
	</section>
</div>

<style>
	.felt {
		background:
			radial-gradient(ellipse at 50% 40%, rgb(255 255 255 / 0.07), transparent 60%),
			radial-gradient(ellipse at center, var(--color-felt) 0%, var(--color-felt-deep) 100%);
		box-shadow:
			inset 0 0 0 2px rgb(210 165 76 / 0.2),
			inset 0 -20px 40px rgb(0 0 0 / 0.35);
	}

	/* Each card overlaps the next by 0.75rem, the last one too, so the fan is nudged back to the centre. */
	.fan {
		transform: translateX(-0.375rem);
		transition: transform 200ms ease;
	}

	.game:hover .fan,
	.game:focus-visible .fan {
		transform: translate(-0.375rem, -4px);
	}

	@media (prefers-reduced-motion: reduce) {
		.fan {
			transition: none;
		}
	}

	/*
	 * Motion (see landing-motion.ts) brings these in, so they start hidden once scripts run
	 * (app.html marks <html> with `js`). Reduced motion keeps the page still and visible.
	 * Should the script never start, the hero shows itself after a moment anyway.
	 */
	@media (prefers-reduced-motion: no-preference) {
		:global(html.js) div:not(.still) :is([data-enter], [data-deal], [data-reveal], [data-step]) {
			opacity: 0;
		}

		:global(html.js) div:not(.still) :is([data-enter], [data-deal]) {
			animation: show-anyway 0s 3s forwards;
		}
	}

	@keyframes show-anyway {
		to {
			opacity: 1;
		}
	}
</style>
