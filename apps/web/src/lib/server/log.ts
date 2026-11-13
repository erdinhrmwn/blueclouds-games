import { destination as fileDestination, pino } from 'pino';
import { dev } from '$app/env';
import { LOG_LEVEL } from '$app/env/private';

/** Readable lines in vite dev; JSON lines in the build, so logs can be grepped and shipped. */
async function destination() {
	if (!dev) {
		return fileDestination(1);
	}

	// A devDependency, loaded only in dev; the build drops this branch.
	const { default: pretty } = await import('pino-pretty');

	return pretty({ translateTime: 'SYS:HH:MM:ss.l', ignore: 'app' });
}

/** One line per server-side event. */
export const log = pino(
	{
		level: LOG_LEVEL,
		base: { app: 'web' },
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label) => ({ level: label })
		}
	},
	await destination()
);
