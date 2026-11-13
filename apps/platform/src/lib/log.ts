import { pino } from "pino";

/**
 * One JSON line per event, so logs can be grepped and shipped as-is. LOG_LEVEL picks the least
 * severe level written (default info); pino throws at startup on an unknown level.
 */
export const log = pino({
	level: process.env.LOG_LEVEL ?? "info",
	base: { app: "platform" },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label }),
	},
});
