import { destination as fileDestination, pino } from 'pino'
import { loadLogConfig } from '../../config'

/** Readable lines while developing; JSON lines in production, so logs can be grepped and shipped. */
const config = loadLogConfig()

/** pino-pretty is a devDependency, so it is loaded only when used. */
async function destination() {
  if (!config.pretty) {
    return fileDestination(1)
  }

  const { default: pretty } = await import('pino-pretty')

  return pretty({ translateTime: 'SYS:HH:MM:ss.l', ignore: 'app' })
}

/**
 * RivetKit logs through this logger too (registry `logging.baseLogger`), so actors' `c.log` and
 * the engine driver share its level and format. LOG_LEVEL picks the least severe level written
 * (default info); an unknown level fails at startup.
 */
export const log = pino(
  {
    level: config.level,
    base: { app: 'server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  await destination(),
)
