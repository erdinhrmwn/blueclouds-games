import { expect, test } from "bun:test";
import { SCHEDULES } from "./index";

test("every job schedule is a valid cron expression with a next run", () => {
	for (const cron of Object.values(SCHEDULES)) expect(Bun.cron.parse(cron, Date.now(), { tz: "UTC" })).toBeInstanceOf(Date);
});

test("the guest sweep runs at 03:00 WIB", () => {
	const next = Bun.cron.parse(SCHEDULES.guestSweep, Date.UTC(2026, 0, 1), { tz: "UTC" });
	expect(next?.toISOString()).toBe("2026-01-01T20:00:00.000Z");
});
