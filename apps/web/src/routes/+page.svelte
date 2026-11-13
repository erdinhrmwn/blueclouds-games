<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { GAMES } from '#lib/games/catalog.ts';
	import Nimbus from '#lib/components/Nimbus.svelte';
	import TableCodeJoin from '#lib/components/TableCodeJoin.svelte';
	import { playLanding } from '#lib/landing-motion.ts';

	const fewestPlayers = Math.min(...GAMES.map((game) => game.minPlayers));
	const mostPlayers = Math.max(...GAMES.map((game) => game.maxPlayers));

	const STEPS = [
		{
			title: 'Open a table',
			text: 'Pick a game. You host, so you decide when the first hand is dealt.'
		},
		{
			title: 'Send the link',
			text: 'Copy the table’s link and send it. Friends land straight in a seat.'
		},
		{
			title: 'Fill the rest with bots',
			text: 'Short on players? Press + on an empty chair and Nimbus deals them in.'
		}
	];
	/** The steps lie on the table a little askew, like cards dealt by hand. */
	const STEP_TILT = [-2.5, 1.5, -1];

	/**
	 * The fan dealt on the hero's table: five backs taking turns from every game in the catalog, so a new
	 * game shows up here without touching the page.
	 */
	const FAN_SIZE = 5;
	const heroFan = Array.from({ length: FAN_SIZE }, (_, index) => ({
		back: GAMES[index % GAMES.length]!.back,
		offset: index - (FAN_SIZE - 1) / 2
	}));

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
		class="grid gap-10 pt-10 md:grid-cols-[1fr_1.05fr] md:items-center md:pt-16"
		aria-labelledby="hero-title"
		data-hero
	>
		<div data-hero-text>
			<h1
				id="hero-title"
				data-enter
				class="font-display text-5xl leading-[0.95] font-black sm:text-7xl"
			>
				Pull up<br />a chair.
			</h1>
			<p class="mt-5 max-w-xl text-lg leading-relaxed text-paper/80" data-enter>
				Quick card games for {fewestPlayers} to {mostPlayers} players. Open a table, send your friends
				the link, and let bots take any seat that’s left.
			</p>
			<div class="mt-7 flex max-w-xl flex-col gap-3 sm:flex-row" data-enter>
				<a class="btn-brass h-12 shrink-0 rounded-xl px-7 text-base" href="#games-title"
					>Pick a game</a
				>
				<TableCodeJoin />
			</div>
		</div>

		<!-- The far half of a table seen from your chair: Nimbus in the pit, a fan of backs on the felt. -->
		<div class="table-edge relative h-72 rounded-t-[1.75rem] sm:h-80" aria-hidden="true">
			<div class="felt absolute inset-x-4 top-4 bottom-0 rounded-t-[1.25rem]"></div>
			<div class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" data-depth="40">
				<div class="pit grid size-24 place-items-center rounded-full" data-deal>
					<Nimbus class="size-16" />
				</div>
			</div>
			<div class="absolute inset-x-0 top-[42%] flex justify-center" data-depth="110">
				{#each heroFan as card, index (index)}
					<div
						class="-mx-3 sm:-mx-4"
						style="rotate: {card.offset * 9}deg; translate: 0 {card.offset * card.offset * 5}px"
						data-deal
					>
						<span class="card-back {card.back} block h-28 w-20 sm:h-32 sm:w-[5.5rem]"></span>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<section class="mt-16 md:mt-24" aria-labelledby="games-title">
		<h2 id="games-title" class="scroll-mt-6 font-display text-3xl font-bold sm:text-4xl">
			Pick a game
		</h2>
		<!-- One tile per game in the catalog, then a spot for the next one; phones get a compact list. -->
		<ul class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
			{#each GAMES as game (game.slug)}
				<li data-reveal>
					<a
						href="/{game.slug}"
						class="game group flex h-full items-center gap-4 overflow-hidden rounded-2xl border border-paper/12 bg-panel p-4 transition-colors hover:border-brass/60 sm:flex-col sm:items-stretch sm:gap-0 sm:p-0"
						aria-label="Play {game.name}"
						aria-describedby="{game.slug}-tagline"
					>
						<div class="felt hidden h-40 place-items-center sm:grid">
							<div data-float>
								<div data-fan>
									<div class="fan">
										<game.Fan size="sm" />
									</div>
								</div>
							</div>
						</div>
						<span
							class="card-back {game.back} block h-[4.5rem] w-[3.25rem] shrink-0 -rotate-3 sm:hidden"
							aria-hidden="true"
						></span>
						<div class="flex min-w-0 flex-1 flex-col sm:p-6">
							<h3 class="font-display text-xl font-bold sm:text-2xl">{game.name}</h3>
							<p
								id="{game.slug}-tagline"
								class="mt-1 text-sm leading-relaxed text-paper/75 sm:mt-2"
							>
								{game.tagline}
							</p>
							<p class="mt-1.5 text-xs text-paper/50">
								{game.kind.charAt(0).toUpperCase()}{game.kind.slice(1)}, {game.minPlayers}–{game.maxPlayers}
								players
							</p>
							<span class="btn-brass mt-5 hidden h-11 rounded-xl sm:inline-flex" aria-hidden="true"
								>Play {game.name}</span
							>
						</div>
					</a>
				</li>
			{/each}
			<li
				class="grid place-items-center rounded-2xl border border-dashed border-paper/22 p-6 text-center max-sm:py-5"
			>
				<p class="font-semibold text-paper/60">More tables on the way</p>
				<p class="mt-1 text-sm text-paper/40 max-sm:hidden">New games show up here.</p>
			</li>
		</ul>
	</section>

	<section class="mt-20 mb-6" aria-labelledby="night-title">
		<h2 id="night-title" class="font-display text-3xl font-bold sm:text-4xl">
			How a game night works
		</h2>
		<ol class="mt-8 grid gap-5 sm:grid-cols-3 sm:gap-6" data-steps>
			{#each STEPS as step, index (step.title)}
				<li
					class="step rounded-2xl bg-paper p-6 text-ink"
					style="rotate: {STEP_TILT[index]}deg"
					data-step
				>
					<h3 class="flex items-baseline gap-3 font-display text-lg font-bold">
						<span class="text-3xl font-black text-ember" aria-hidden="true">{index + 1}</span>
						{step.title}
					</h3>
					<p class="mt-3 leading-relaxed text-ink/75">{step.text}</p>
				</li>
			{/each}
		</ol>
	</section>
</div>

<style>
	.table-edge {
		background: linear-gradient(180deg, var(--color-rim-light), var(--color-rim));
	}
	.pit {
		background: radial-gradient(circle at 50% 40%, #241b14, var(--color-room) 70%);
		box-shadow:
			0 0 0 2px var(--color-brass),
			0 0 0 7px var(--color-room),
			0 10px 22px rgb(0 0 0 / 0.5);
	}
	.step {
		box-shadow:
			inset 0 0 0 6px var(--color-paper),
			inset 0 0 0 7px rgb(34 28 22 / 0.14),
			0 8px 18px rgb(0 0 0 / 0.35);
	}
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
