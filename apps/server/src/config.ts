import { z } from 'zod'

// The only module that reads the environment. Each part is loaded on its own, so a test that only logs
// never needs the platform keys.

type RawEnv = Record<string, string | undefined>

const PlatformEnv = z.object({
  /** Ed25519 public key (32 bytes, base64url) matching the platform's PLAY_TOKEN_PRIVATE_KEY. */
  PLAY_TOKEN_PUBLIC_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{43}$/,
      'must be a 43-character base64url Ed25519 key; run `bun run --filter platform keys:generate`',
    ),
  /** Where the actor server reaches the platform API (server to server, not the public URL). */
  PLATFORM_URL: z
    .url()
    .default('http://127.0.0.1:3000')
    .transform((url) => url.replace(/\/+$/, '')),
  /** Bearer key for calls to the platform (match reports, tournament rooms); same value as the platform's. */
  PLATFORM_SERVER_KEY: z.string().min(32, 'must be at least 32 characters'),
})

const RivetEnv = z.object({
  RIVET_ENDPOINT: z.url().optional(),
  /** The engine's admin token. Empty or unset: no connection is ever an admin. */
  RIVET_TOKEN: z.string().optional(),
})

const LogEnv = z.object({
  /** The least severe level written. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.string().optional(),
})

export interface PlatformConfig {
  url: string
  serverKey: string
  playTokenPublicKey: string
}

export interface RivetConfig {
  endpoint: string | undefined
  adminToken: string | undefined
}

export interface LogConfig {
  level: z.output<typeof LogEnv>['LOG_LEVEL']
  /** Readable lines while developing; JSON lines in production. */
  pretty: boolean
}

function check<S extends z.ZodType>(schema: S, env: RawEnv, what: string): z.output<S> {
  const parsed = schema.safeParse(env)
  if (parsed.success) {
    return parsed.data
  }

  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')

  throw new Error(`Invalid ${what}: ${problems}`)
}

/** How to reach the platform and check its play tokens. Call at boot so a bad .env fails fast. */
export function loadPlatformConfig(env: RawEnv = process.env): PlatformConfig {
  const parsed = check(PlatformEnv, env, 'actor server config')

  return {
    url: parsed.PLATFORM_URL,
    serverKey: parsed.PLATFORM_SERVER_KEY,
    playTokenPublicKey: parsed.PLAY_TOKEN_PUBLIC_KEY,
  }
}

export function loadRivetConfig(env: RawEnv = process.env): RivetConfig {
  const parsed = check(RivetEnv, env, 'Rivet config')

  return { endpoint: parsed.RIVET_ENDPOINT, adminToken: parsed.RIVET_TOKEN || undefined }
}

export function loadLogConfig(env: RawEnv = process.env): LogConfig {
  const parsed = check(LogEnv, env, 'log config')

  return { level: parsed.LOG_LEVEL, pretty: parsed.NODE_ENV !== 'production' }
}
