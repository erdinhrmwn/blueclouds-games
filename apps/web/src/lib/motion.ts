import { prefersReducedMotion } from 'svelte/motion';
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Places a card on the pile: it travels from `from` (the card in your hand, or the seat of whoever
 * played it) along a small arc, lifts slightly mid-air and lands at its resting size.
 */
export function placeCard(node: Element, { from, tilt = 0 }: { from: DOMRect | null; tilt?: number }): TransitionConfig {
	if (!from || prefersReducedMotion.current) return { duration: 0 };
	const to = node.getBoundingClientRect();
	const dx = from.left + from.width / 2 - (to.left + to.width / 2);
	const dy = from.top + from.height / 2 - (to.top + to.height / 2);
	const startScale = Math.min(1.4, Math.max(0.35, from.width / to.width));
	const arc = Math.min(80, Math.hypot(dx, dy) * 0.25);
	return {
		duration: 420,
		easing: cubicOut,
		css: (t, u) =>
			`transform: translate(${dx * u}px, ${dy * u - arc * Math.sin(Math.PI * t)}px) rotate(${tilt * u}deg) scale(${(startScale * u + t) * (1 + 0.08 * Math.sin(Math.PI * t))}); z-index: 5`
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
	node.animate(
		[0, -10, 9, -7, 5, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
		{ duration: 450, easing: 'ease-out' }
	);
}

type Countdown = { ms: number; total: number; kind: 'bar' | 'ring' } | null;

/**
 * Drains a timer bar (scaleX) or ring (stroke-dashoffset) every frame with the Web Animations API.
 * A new value restarts the animation only when the deadline really moved, so the frequent
 * re-renders around it (seconds label ticking, server echoes) never make it jump.
 */
export function countdown(node: Element, params: Countdown) {
	let anim: Animation | undefined;
	let endsAt = 0;

	function run(p: Countdown) {
		if (!p) {
			anim?.cancel();
			anim = undefined;
			return;
		}
		if (anim && Math.abs(endsAt - performance.now() - p.ms) < 300) return;
		anim?.cancel();
		endsAt = performance.now() + p.ms;
		const left = Math.min(1, p.ms / p.total);
		const frames =
			p.kind === 'bar'
				? [{ transform: `scaleX(${left})` }, { transform: 'scaleX(0)' }]
				: [{ strokeDashoffset: `${100 * (1 - left)}` }, { strokeDashoffset: '100' }];
		anim = node.animate(frames, { duration: p.ms, easing: 'linear', fill: 'forwards' });
	}

	run(params);
	return { update: run, destroy: () => anim?.cancel() };
}
