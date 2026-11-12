import type { SQL } from "bun";
import { log } from "../lib/log";
import { sweepGuests } from "../services/guests";
import { runTournamentJob } from "../services/tournaments";

/** Cron expressions, read in UTC. Bun.cron has minute resolution. */
export const SCHEDULES = {
	/** Distributes tournaments whose registration closed and closes rooms nobody opened. */
	tournaments: "* * * * *",
	/** Deletes unused guests, at 03:00 WIB. */
	guestSweep: "0 20 * * *",
} as const;

/**
 * Schedules the platform jobs with Bun.cron in this process. A job's next run starts only after the last one settles.
 * ponytail: every platform instance runs every job. That is safe: the tournament job uses SKIP LOCKED and the sweep
 * is an idempotent DELETE. Jobs that need exactly-once runs, per-item retries or run history would call for pg-boss
 * on the same Postgres.
 */
export function startJobs(sql: SQL): { stop: () => Promise<void> } {
	const running = new Set<Promise<unknown>>();

	/** `run` returns log fields when the run did something worth logging. */
	const schedule = (
		name: string,
		cron: string,
		run: () => Promise<Record<string, unknown> | null>,
	) =>
		Bun.cron(
			cron,
			() => {
				// Errors are caught here: an unhandled rejection from a cron callback exits the process.
				const p: Promise<unknown> = run()
					.then((fields) => fields && log.info({ msg: name, ...fields }))
					.catch((err) => log.error({ msg: `${name} failed`, err: String(err) }))
					.finally(() => running.delete(p));
				running.add(p);
				return p;
			},
			{ tz: "UTC" },
		);

	const jobs = [
		schedule("tournament job", SCHEDULES.tournaments, async () => {
			const r = await runTournamentJob(sql);
			return r.distributed + r.failed + r.closed > 0 ? r : null;
		}),
		schedule("guest sweep", SCHEDULES.guestSweep, async () => {
			const deleted = await sweepGuests(sql);
			return deleted > 0 ? { deleted } : null;
		}),
	];

	return {
		stop: async () => {
			for (const job of jobs) job.stop();
			await Promise.all(running);
		},
	};
}
