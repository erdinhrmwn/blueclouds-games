import { pino } from "pino";

/**
 * One JSON line per event. RivetKit logs through it too (registry `logging.baseLogger`), so
 * actors' `c.log` and the engine driver share this level and format. LOG_LEVEL picks the least
 * severe level written (default info); pino throws at startup on an unknown level.
 */
export const log = pino({
	level: process.env.LOG_LEVEL ?? "info",
	base: { app: "server" },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label }),
	},
});
