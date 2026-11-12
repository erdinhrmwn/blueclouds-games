<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';

	/** Card backs burst out of the centre of the table and tumble down, like a won game of patience. */
	const COUNT = 22;
	const pieces = Array.from({ length: COUNT }, (_, i) => {
		const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.4;
		const reach = 140 + Math.random() * 220;
		return {
			x: Math.cos(angle) * reach,
			y: Math.sin(angle) * reach * 0.6 - 60,
			fall: 260 + Math.random() * 260,
			spin: (Math.random() - 0.5) * 720,
			delay: Math.random() * 0.35,
			face: i % 4 === 0
		};
	});
</script>

{#if !prefersReducedMotion.current}
	<!-- fixed + clipped so flying cards never cause page scroll on small screens -->
	<div class="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
		{#each pieces as p, i (i)}
			<span
				class="piece {p.face ? 'face' : 'card-back'}"
				style="--x: {p.x}px; --y: {p.y}px; --fall: {p.fall}px; --spin: {p.spin}deg; animation-delay: {p.delay}s"
			></span>
		{/each}
	</div>
{/if}

<style>
	.piece {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 1.6rem;
		height: 2.3rem;
		margin: -1.15rem 0 0 -0.8rem;
		opacity: 0;
		animation: burst 2.4s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
	}
	.face {
		border-radius: 0.3rem;
		background: var(--color-paper);
		box-shadow: inset 0 0 0 2px var(--color-brass);
	}
	@keyframes burst {
		0% {
			opacity: 1;
			transform: translate(0, 0) rotate(0) scale(0.4);
		}
		45% {
			opacity: 1;
			transform: translate(var(--x), var(--y)) rotate(calc(var(--spin) * 0.5)) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate(var(--x), calc(var(--y) + var(--fall))) rotate(var(--spin)) scale(1);
		}
	}
</style>
