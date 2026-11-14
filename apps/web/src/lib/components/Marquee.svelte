<script lang="ts">
	import { animate, type AnimationPlaybackControls } from 'motion';
	import { prefersReducedMotion } from 'svelte/motion';

	/**
	 * One line of text that scrolls slowly back and forth when it is wider than its box, and sits still
	 * when it fits. Hovering or focusing it pauses the scroll; reduced motion cuts it with an ellipsis.
	 */
	let { text, class: cls = '' }: { text: string; class?: string } = $props();

	/** Pixels per second, and the rest at each end before it turns back. */
	const SPEED = 30;
	const REST_S = 1.5;

	let box = $state<HTMLElement>();
	let line = $state<HTMLElement>();
	let overflow = $state(0);

	$effect(() => {
		if (!box || !line) {
			return;
		}

		const measure = () => {
			overflow = Math.max(0, line!.scrollWidth - box!.clientWidth);
		};
		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(box);
		return () => observer.disconnect();
	});

	let controls: AnimationPlaybackControls | undefined;

	$effect(() => {
		// Re-run when the text or the room for it changes.
		void text;
		const distance = overflow;
		controls?.stop();
		controls = undefined;

		if (!line || distance === 0 || prefersReducedMotion.current) {
			if (line) {
				line.style.transform = '';
			}

			return;
		}

		const travel = distance / SPEED;
		const total = travel * 2 + REST_S * 2;
		controls = animate(
			line,
			{ x: [0, 0, -distance, -distance, 0] },
			{
				duration: total,
				times: [0, REST_S / total, (REST_S + travel) / total, (REST_S * 2 + travel) / total, 1],
				ease: 'linear',
				repeat: Infinity
			}
		);

		return () => controls?.stop();
	});

	const pause = () => controls?.pause();
	const resume = () => controls?.play();
</script>

<!-- ARIA's marquee role: changing text that is not important enough to announce. -->
<span
	bind:this={box}
	class="block overflow-hidden {cls}"
	title={overflow > 0 ? text : undefined}
	role="marquee"
	onpointerenter={pause}
	onpointerleave={resume}
	onfocusin={pause}
	onfocusout={resume}
>
	<span
		bind:this={line}
		class="inline-block whitespace-nowrap"
		class:truncate-line={prefersReducedMotion.current}>{text}</span
	>
</span>

<style>
	/* Reduced motion: no scroll, the line is cut with an ellipsis instead. */
	.truncate-line {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
