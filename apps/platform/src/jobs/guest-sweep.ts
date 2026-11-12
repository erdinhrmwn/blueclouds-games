import type { SQL } from "bun";
import { log } from "../lib/log";
import { sweepGuests } from "../services/guests";

const SWEEP_EVERY_MS = 24 * 60 * 60_000;

/**
 * Sweeps once at start, then daily, in this process.
 * ponytail: fine for one VPS; with several platform instances each sweeps, which is harmless (DELETE is idempotent).
 */
export function startGuestSweep(sql: SQL): { stop: () => Promise<void> } {
	let running: Promise<unknown> | null = null;
	const tick = () => {
		if (running) return;
		running = sweepGuests(sql)
			.then((deleted) => deleted > 0 && log.info({ msg: "guest sweep", deleted }))
			.catch((err) => log.error({ msg: "guest sweep failed", err: String(err) }))
			.finally(() => (running = null));
	};
	const timer = setInterval(tick, SWEEP_EVERY_MS);
	tick();
	return {
		stop: async () => {
			clearInterval(timer);
			await running;
		},
	};
}
