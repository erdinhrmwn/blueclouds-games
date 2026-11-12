import { animate, type AnimationPlaybackControls, inView, scroll, stagger } from 'motion';

/**
 * The landing page's motion, driven by the Motion library and marked up with data attributes:
 * - `data-enter`: hero text that rises in on load.
 * - `data-deal` (inside a `data-depth` layer): loose cards dealt onto the hero on load.
 * - `data-depth="<px>"`: a hero layer that rises that far while the hero scrolls away (parallax).
 * - `data-hero-text`: the hero's text block, which drifts up and fades as it scrolls away.
 * - `data-reveal`: a game card that springs in when it comes into view, its `data-fan` cards
 *   bouncing up a beat later and its `data-float` layer drifting while it passes.
 * - `data-steps` / `data-step`: steps that rise in one after another.
 * Elements start hidden in CSS (see the page) and Motion brings them in.
 * Returns a cleanup that stops every animation and listener.
 */

type ScrollOptions = NonNullable<Parameters<typeof scroll>[1]>;

const SPRING = { type: 'spring', bounce: 0.25, duration: 0.9 } as const;
const BOUNCY = { type: 'spring', bounce: 0.45, duration: 1 } as const;
const CARD_DELAY_S = 0.12;
/** Share of an element that must be on screen before it comes in. */
const IN_VIEW_AMOUNT = 0.25;

export function playLanding(root: HTMLElement): () => void {
	const running: AnimationPlaybackControls[] = [];
	const stops: VoidFunction[] = [];

	const all = (selector: string, within: ParentNode = root) =>
		Array.from(within.querySelectorAll<HTMLElement>(selector));

	const play = (...args: Parameters<typeof animate>) => {
		const controls = animate(...args);
		running.push(controls);
		return controls;
	};

	/** Calls `start` the first time `element` comes into view. */
	const once = (element: Element, start: () => void) => {
		const stop = inView(
			element,
			() => {
				start();
				stop();
			},
			{ amount: IN_VIEW_AMOUNT }
		);
		stops.push(stop);
	};

	// Hero: the text rises in, then the loose cards are dealt onto the table.
	play(all('[data-enter]'), { opacity: [0, 1], y: [32, 0] }, { ...SPRING, delay: stagger(0.09) });
	play(
		all('[data-deal]'),
		{ opacity: [0, 1], x: [-80, 0], y: [160, 0], rotate: [-30, 0] },
		{ ...BOUNCY, delay: stagger(0.12, { startDelay: 0.25 }) }
	);

	// Hero parallax: near layers rise more than far ones while the hero scrolls away.
	const hero = root.querySelector('[data-hero]');
	if (hero) {
		const heroScroll: ScrollOptions = { target: hero, offset: ['start start', 'end start'] };

		for (const layer of all('[data-depth]')) {
			const depth = Number(layer.dataset.depth);
			const rise = animate(layer, { y: [0, -depth] }, { ease: 'linear' });
			stops.push(scroll(rise, heroScroll));
		}

		for (const text of all('[data-hero-text]')) {
			const drift = animate(text, { y: [0, -80], opacity: [1, 0.2] }, { ease: 'linear' });
			stops.push(scroll(drift, heroScroll));
		}
	}

	// Game cards spring in; their fans bounce up a beat later and float while the card passes.
	all('[data-reveal]').forEach((card, index) => {
		const delay = index * CARD_DELAY_S;

		once(card, () => {
			play(card, { opacity: [0, 1], y: [80, 0], scale: [0.94, 1] }, { ...SPRING, delay });
			play(
				all('[data-fan]', card),
				{ y: [48, 0], rotate: [-10, 0], scale: [0.85, 1] },
				{ ...BOUNCY, delay: delay + 0.15 }
			);
		});

		for (const layer of all('[data-float]', card)) {
			const float = animate(layer, { y: [24, -24] }, { ease: 'linear' });
			stops.push(scroll(float, { target: card, offset: ['start end', 'end start'] }));
		}
	});

	// Steps rise in one after another.
	for (const list of all('[data-steps]')) {
		once(list, () => {
			play(
				all('[data-step]', list),
				{ opacity: [0, 1], y: [40, 0] },
				{ ...SPRING, delay: stagger(0.12) }
			);
		});
	}

	return () => {
		for (const stop of stops) {
			stop();
		}

		for (const controls of running) {
			controls.stop();
		}
	};
}
