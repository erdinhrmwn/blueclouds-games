import type { SQL } from "bun";
import { log } from "../lib/log";
import { runTournamentJob } from "../services/tournaments";

/** How often the job distributes due tournaments and closes rooms nobody opened. */
export const JOB_EVERY_MS = 30_000;

/**
 * Runs the job every JOB_EVERY_MS in this process; no cron needed.
 * ponytail: an in-process loop fits one VPS. SKIP LOCKED keeps it safe with more instances; only a far
 * larger number of jobs would call for a real queue.
 */
export function startTournamentJob(sql: SQL): { stop: () => Promise<void> } {
	let running: Promise<unknown> | null = null;
	const tick = () => {
		if (running) return; // the last tick is still busy
		running = runTournamentJob(sql)
			.then((r) => r.distributed + r.failed + r.closed > 0 && log.info({ msg: "tournament job", ...r }))
			.catch((err) => log.error({ msg: "tournament job failed", err: String(err) }))
			.finally(() => (running = null));
	};
	const timer = setInterval(tick, JOB_EVERY_MS);
	tick();
	return {
		stop: async () => {
			clearInterval(timer);
			await running;
		},
	};
}
