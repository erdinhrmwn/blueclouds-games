import { destination as fileDestination, pino } from "pino";

/** Readable lines while developing; JSON lines in production, so logs can be grepped and shipped. */
const PRETTY = process.env.NODE_ENV !== "production";

/** pino-pretty is a devDependency, so it is loaded only when used. */
async function destination() {
	if (!PRETTY) {
		return fileDestination(1);
	}

	const { default: pretty } = await import("pino-pretty");

	return pretty({ translateTime: "SYS:HH:MM:ss.l", ignore: "app" });
}

/**
 * RivetKit logs through this logger too (registry `logging.baseLogger`), so actors' `c.log` and
 * the engine driver share its level and format. LOG_LEVEL picks the least severe level written
 * (default info); pino throws at startup on an unknown level.
 */
export const log = pino(
	{
		level: process.env.LOG_LEVEL ?? "info",
		base: { app: "server" },
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label) => ({ level: label }),
		},
	},
	await destination(),
);
