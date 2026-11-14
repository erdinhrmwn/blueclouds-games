<script lang="ts">
	import type { Card } from 'server/games/bust-31/rules';
	import { placeCard, seatRect } from '#lib/motion.ts';
	import { prefersReducedMotion } from 'svelte/motion';
	import PlayingCard from './PlayingCard.svelte';

	/** Shown for a moment after someone pushes the total over the limit. */
	let {
		card,
		total,
		playerId,
		eliminated
	}: { card: Card; total: number; playerId: string; eliminated: boolean } = $props();
</script>

<div
	class="bust pointer-events-none absolute -inset-x-[15%] -inset-y-[25%] z-10 grid place-items-center"
	class:still={prefersReducedMotion.current}
	aria-hidden="true"
>
	<div class="relative" in:placeCard|global={{ from: seatRect(playerId), tilt: -25 }}>
		<PlayingCard {card} />
		<p
			class="stamp absolute top-1/2 left-1/2 rounded-md border-4 border-ember bg-room/85 px-3 py-1 text-center font-display font-black whitespace-nowrap text-ember"
		>
			<span class="block text-3xl leading-none">{eliminated ? 'Out' : 'Bust'}</span>
			<span class="block text-sm font-bold">{total} &gt; 31</span>
		</p>
	</div>
</div>

<style>
	/* The felt flashes red, the stamp slams down, then everything fades so play continues. */
	.bust {
		animation: flash 1.8s ease-out forwards;
	}
	.stamp {
		transform: translate(-50%, -50%) rotate(-12deg);
		animation: slam 1.8s ease-out forwards;
	}
	/* A soft red glow from the middle of the felt, with no hard edge. */
	.bust::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: radial-gradient(ellipse at center, rgb(217 100 63 / 0.4), transparent 65%);
		animation: glow 1.8s ease-out forwards;
	}
	@keyframes glow {
		0% {
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	@keyframes flash {
		80% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	@keyframes slam {
		0%,
		22% {
			opacity: 0;
			transform: translate(-50%, -50%) rotate(-12deg) scale(2.4);
		}
		32% {
			opacity: 1;
			transform: translate(-50%, -50%) rotate(-12deg) scale(0.92);
		}
		40%,
		100% {
			opacity: 1;
			transform: translate(-50%, -50%) rotate(-12deg) scale(1);
		}
	}
	.still,
	.still .stamp {
		animation: fade 1.8s steps(1, end) forwards;
	}
	@keyframes fade {
		100% {
			opacity: 0;
		}
	}
</style>
