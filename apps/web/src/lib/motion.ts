import { prefersReducedMotion } from 'svelte/motion';
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

const PLACE_MS = 420;
const SHAKE_MS = 450;
/** A countdown restarts only when its deadline moved by more than this. */
const DEADLINE_JITTER_MS = 300;
/** Size of a flying face-down card in the deal. */
const DEAL_CARD = { width: 28, height: 40 };

const centerOf = (rect: DOMRect) => ({
	x: rect.left + rect.width / 2,
	y: rect.top + rect.height / 2
});

/**
 * Places a card on the pile: it travels from `from` (the card in your hand, or the seat of whoever
 * played it) along a small arc, lifts slightly mid-air and lands at its resting size.
 */
export function placeCard(
	node: Element,
	{ from, tilt = 0 }: { from: DOMRect | null; tilt?: number }
): TransitionConfig {
	if (!from || prefersReducedMotion.current) return { duration: 0 };

	const to = node.getBoundingClientRect();
	const start = centerOf(from);
	const end = centerOf(to);
	const dx = start.x - end.x;
	const dy = start.y - end.y;

	const startScale = Math.min(1.4, Math.max(0.35, from.width / to.width));
	const arc = Math.min(80, Math.hypot(dx, dy) * 0.25);

	return {
		duration: PLACE_MS,
		easing: cubicOut,
		// t runs 0 → 1, u = 1 - t. sin(πt) peaks mid-flight: the arc height and the slight lift.
		css: (t, u) => {
			const lift = Math.sin(Math.PI * t);
			const x = dx * u;
			const y = dy * u - arc * lift;
			const scale = (startScale * u + t) * (1 + 0.08 * lift);

			return `transform: translate(${x}px, ${y}px) rotate(${tilt * u}deg) scale(${scale}); z-index: 5`;
		}
	};
}

/** Where a player's card starts its flight: the centre of their seat. */
export function seatRect(playerId: string | null): DOMRect | null {
	const seat = playerId ? document.querySelector(`[data-seat="${CSS.escape(playerId)}"]`) : null;
	return seat?.getBoundingClientRect() ?? null;
}

/** Short horizontal shake, used when someone busts. */
export function shake(node: HTMLElement | undefined): void {
	if (!node || prefersReducedMotion.current) return;

	const offsets = [0, -10, 9, -7, 5, -3, 0];
	const frames = offsets.map((x) => ({ transform: `translateX(${x}px)` }));
	node.animate(frames, { duration: SHAKE_MS, easing: 'ease-out' });
}

type Countdown = { ms: number; total: number } | null;

/**
 * Drains a timer ring (stroke-dashoffset) every frame with the Web Animations API.
 * A new value restarts the animation only when the deadline really moved, so the frequent
 * re-renders around it (seconds label ticking, server echoes) never make it jump.
 */
export function countdown(node: Element, params: Countdown) {
	let anim: Animation | undefined;
	let endsAt = 0;

	function run(timer: Countdown) {
		if (!timer) {
			anim?.cancel();
			anim = undefined;
			return;
		}

		const deadlineMoved = Math.abs(endsAt - performance.now() - timer.ms) >= DEADLINE_JITTER_MS;
		if (anim && !deadlineMoved) return;

		anim?.cancel();
		endsAt = performance.now() + timer.ms;

		// More time than the turn length means the clock has not started yet (the dealer is dealing):
		// stay full for the difference, then drain.
		const delay = Math.max(0, timer.ms - timer.total);
		const left = Math.min(1, timer.ms / timer.total);

		const frames = [{ strokeDashoffset: `${100 * (1 - left)}` }, { strokeDashoffset: '100' }];

		anim = node.animate(frames, {
			delay,
			duration: timer.ms - delay,
			easing: 'linear',
			fill: 'both'
		});
	}

	run(params);
	return { update: run, destroy: () => anim?.cancel() };
}

/**
 * The dealer deals: face-down cards fly from `from` (the deck) to each seat in turn,
 * going around the table `passes` times. Pure decoration, so it lives outside Svelte's tree
 * in a fixed layer and cleans up after itself.
 */
export function dealCards(
	from: DOMRect | null,
	seats: (DOMRect | null)[],
	{ passes, stepMs, flightMs }: { passes: number; stepMs: number; flightMs: number }
): void {
	const targets = seats.filter((rect): rect is DOMRect => rect !== null);
	if (!from || targets.length === 0 || prefersReducedMotion.current) return;

	const layer = document.createElement('div');
	layer.setAttribute('aria-hidden', 'true');
	layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:30';
	document.body.append(layer);

	const { width, height } = DEAL_CARD;
	const start = centerOf(from);
	// The flight layer sits on <body>, outside the table, so it takes the deck's card back along.
	const deck = document.querySelector('[data-deck]');
	if (deck) {
		const deckStyle = getComputedStyle(deck);
		for (const property of ['--card-back', '--card-back-size', '--card-back-border']) {
			const value = deckStyle.getPropertyValue(property);
			if (value) {
				layer.style.setProperty(property, value);
			}
		}
	}
	let last: Animation | undefined;

	for (let pass = 0; pass < passes; pass++) {
		targets.forEach((to, index) => {
			const card = document.createElement('span');
			card.className = 'card-back';
			card.style.cssText = [
				'position:absolute',
				`width:${width}px`,
				`height:${height}px`,
				`left:${start.x - width / 2}px`,
				`top:${start.y - height / 2}px`,
				'opacity:0'
			].join(';');
			layer.append(card);

			const end = centerOf(to);
			const move = `translate(${end.x - start.x}px, ${end.y - start.y}px)`;
			// Cards spin alternately left and right.
			const spin = `rotate(${(index % 2 ? 1 : -1) * 200}deg)`;

			const frames = [
				{ transform: 'translate(0, 0) rotate(0deg) scale(0.9)', opacity: 1 },
				{ transform: `${move} ${spin} scale(0.7)`, opacity: 1, offset: 0.9 },
				{ transform: `${move} ${spin} scale(0.5)`, opacity: 0 }
			];

			last = card.animate(frames, {
				delay: (pass * targets.length + index) * stepMs,
				duration: flightMs,
				easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
				fill: 'both'
			});
		});
	}

	const cleanUp = () => layer.remove();
	last?.finished.then(cleanUp, cleanUp);
}

/**
 * Calls `land(n)` as the n-th card of a `dealCards` deal (started `delayMs` from now) reaches the
 * seat at `seatIndex`, so your hand can fill one card at a time. Does nothing for a seat not dealt to.
 */
export function whenDealt(
	seatIndex: number,
	seatCount: number,
	{ passes, stepMs, flightMs }: { passes: number; stepMs: number; flightMs: number },
	delayMs: number,
	land: (count: number) => void
): void {
	if (seatIndex < 0) return;

	for (let pass = 0; pass < passes; pass += 1) {
		const landsAt = delayMs + (pass * seatCount + seatIndex) * stepMs + flightMs;
		setTimeout(() => land(pass + 1), landsAt);
	}
}
