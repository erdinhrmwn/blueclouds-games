import { pino } from 'pino';
import { LOG_LEVEL } from '$app/env/private';

/** One JSON line per server-side event, so logs can be grepped and shipped as-is. */
export const log = pino({
	level: LOG_LEVEL,
	base: { app: 'web' },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label })
	}
});
