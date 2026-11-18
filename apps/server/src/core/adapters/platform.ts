import { AVATAR_COLORS, AVATAR_ICONS, NO_AVATAR } from 'contracts/avatars'
import { type ClientRequestOptions, hc } from 'hono/client'
import { importJWK, jwtVerify } from 'jose'
import type { AppType } from 'platform/rpc'
import { z } from 'zod'
import { type MatchId, type PlayerId, toPlayerId } from '../domain/ids'
import type { MatchReport, RoundReport } from '../domain/match'
import type {
  CloseReason,
  MarkResult,
  PlatformPort,
  PlatformRoom,
  RoomChange,
  SendResult,
} from '../domain/ports'
import type { Identity } from '../domain/room'

// Layer 4, adapter: PlatformPort over the BlueClouds Platform's HTTP API (Hono RPC client), and play tokens checked
// with the platform's public key. Reads its config from env on first use.

/** Must match the platform's PLAY_TOKEN_AUDIENCE. */
const PLAY_TOKEN_AUDIENCE = 'blueclouds-rooms'

const Env = z.object({
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
type Env = z.output<typeof Env>

const PLATFORM_TIMEOUT_MS = 5_000
const MAX_TOKEN_LENGTH = 2048
const MAX_DETAIL_LENGTH = 500
/** Statuses for a body the platform will never accept, so retrying is pointless. */
const REJECTED_STATUSES = [400, 409, 422]

/** A player's account id, as the platform sends it. */
const PlayerIdSchema = z.uuid().transform(toPlayerId)

const Claims = z.object({
  sub: PlayerIdSchema,
  name: z.string().trim().min(1).max(20),
  // Tokens signed before the platform added it have no flag.
  vip: z.boolean().default(false),
  // Older tokens have none; a look this build doesn't know never keeps anyone from their seat.
  avatar: z
    .object({
      color: z.enum(AVATAR_COLORS).nullable(),
      icon: z.enum(AVATAR_ICONS).nullable(),
    })
    .catch(NO_AVATAR),
})

let publicKey: Promise<CryptoKey | Uint8Array> | undefined
let config: Env | undefined

/** Validates the env once; call at boot so a bad config fails fast. */
export function loadPlatformConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = Env.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid actor server config: ${issues}`)
  }

  const jwk = { kty: 'OKP', crv: 'Ed25519', x: parsed.data.PLAY_TOKEN_PUBLIC_KEY }
  publicKey = importJWK(jwk, 'EdDSA')
  config = parsed.data

  return config
}

/** Checks a play token from the platform. Returns who it belongs to, or null if it isn't valid. */
async function verifyPlayToken(token: unknown): Promise<Identity | null> {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    return null
  }

  if (!publicKey) {
    loadPlatformConfig()
  }

  try {
    const { payload } = await jwtVerify(token, await publicKey!, {
      audience: PLAY_TOKEN_AUDIENCE,
      algorithms: ['EdDSA'],
    })

    const claims = Claims.safeParse(payload)
    if (!claims.success) {
      return null
    }

    return {
      id: claims.data.sub,
      name: claims.data.name,
      vip: claims.data.vip,
      avatar: claims.data.avatar,
    }
  } catch {
    return null
  }
}

/**
 * Sends a finished match. "sent": stored (or already stored, the platform is idempotent by matchId).
 * "rejected": the platform will never accept this body, so retrying is pointless. "retry": try again later.
 */
function reportMatch(report: MatchReport): Promise<SendResult> {
  return send(() => platform().matches.$post({ json: report }, requestOptions()))
}

/** Sends a closed round of a running or finished match (rounds.ts); answered like `reportMatch`. */
function reportRound(matchId: MatchId, round: RoundReport): Promise<SendResult> {
  const param = { id: encodeURIComponent(matchId) }

  return send(() =>
    platform().matches[':id'].rounds.$post({ param, json: round }, requestOptions()),
  )
}

async function send(request: () => Promise<Answer>): Promise<SendResult> {
  try {
    const res = await request()
    if (res.ok) {
      return { result: 'sent' }
    }

    const detail = await failureDetail(res)
    const result = REJECTED_STATUSES.includes(res.status) ? 'rejected' : 'retry'

    return { result, detail }
  } catch (err) {
    return { result: 'retry', detail: String(err) }
  }
}

const TournamentRoom = z.object({
  visibility: z.enum(['public', 'private']),
  /** The table's own name; an older platform sends none. */
  name: z.string().max(32).nullable().default(null),
  minPlayers: z.number().int().min(1),
  startedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  tournament: z
    .object({
      id: z.uuid(),
      name: z.string(),
      format: z.enum(['arena', 'knockout', 'swiss']).nullable().default(null),
      /** Arena and Swiss: how many rounds it plays; null for Knockout or from an older platform. */
      rounds: z.number().int().min(1).nullable().default(null),
      /** Everyone still signed up to the tournament; older platforms don't send it. */
      registered: z.number().int().min(0).nullable().default(null),
      /** The tournament round this table plays in; older platforms don't send it. */
      round: z.number().int().min(1).default(1),
      startsAt: z.iso.datetime({ offset: true }),
      cancelled: z.boolean(),
    })
    .nullable(),
  seats: z.array(
    z.object({
      playerId: PlayerIdSchema,
      seat: z.number().int().min(0).nullable(),
      /** A bot account the platform signed up to fill the tables; the room plays its seat. */
      bot: z.boolean().default(false),
      name: z.string().default(''),
    }),
  ),
})

/** The platform's API, typed by its routes (AppType). Made on first use, once the config is loaded. */
let client: ReturnType<typeof createClient> | undefined

function createClient() {
  const { PLATFORM_URL, PLATFORM_SERVER_KEY } = config ?? loadPlatformConfig()

  return hc<AppType>(PLATFORM_URL, {
    headers: { Authorization: `Bearer ${PLATFORM_SERVER_KEY}` },
  }).v1
}

function platform(): ReturnType<typeof createClient> {
  client ??= createClient()
  return client
}

/** The parts of an answer read here, whatever route it came from. */
type Answer = Pick<Response, 'ok' | 'status' | 'text'>

/** Per request: each call gets its own timeout. */
const requestOptions = (): ClientRequestOptions => ({
  init: { signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS) },
})

/** Status and the start of the body, for logs. */
async function failureDetail(res: Answer): Promise<string> {
  const body = await res.text().catch(() => '')
  return `${res.status} ${body}`.slice(0, MAX_DETAIL_LENGTH)
}

/** The room's tournament, start time and seats. Null if the platform doesn't know the room; throws if it can't be reached. */
async function fetchRoomSeats(code: string): Promise<PlatformRoom | null> {
  const param = { code: encodeURIComponent(code) }
  const res = await platform().rooms[':code'].seats.$get({ param }, requestOptions())
  if (res.status === 404) {
    return null
  }

  if (!res.ok) {
    throw new Error(`room seats: ${res.status}`)
  }

  // Parsed, not trusted: a platform one deploy behind or ahead may send another shape.
  const body = RoomSeatsAnswer.parse(await res.json())
  return TournamentRoom.parse(body.data.room)
}

const RoomSeatsAnswer = z.object({ data: z.object({ room: z.unknown() }) })
const VipIds = z.object({ data: z.object({ vipIds: z.array(PlayerIdSchema) }) })

/** Which of these players are VIP right now. Throws if the platform can't be reached. */
async function fetchVipIds(ids: PlayerId[]): Promise<Set<PlayerId>> {
  const query = { ids: ids.join(',') }
  const res = await platform().players.vips.$get({ query }, requestOptions())
  if (!res.ok) {
    throw new Error(`vip lookup: ${res.status}`)
  }

  const { vipIds } = VipIds.parse(await res.json()).data

  return new Set(vipIds)
}

/**
 * Tells the platform a tournament room's match began, or that it closed without one: too few players came, or an
 * admin terminated it. A lost call is fixed by the platform's job and the match report.
 */
async function markRoom(
  code: string,
  change: RoomChange,
  reason: CloseReason = 'not_enough_players',
): Promise<MarkResult> {
  try {
    const room = platform().rooms[':code']
    const param = { code: encodeURIComponent(code) }
    const res =
      change === 'close'
        ? await room.close.$post({ param, json: { reason } }, requestOptions())
        : await room.start.$post({ param }, requestOptions())

    if (res.ok) {
      return { ok: true }
    }

    return { ok: false, detail: await failureDetail(res) }
  } catch (err) {
    return { ok: false, detail: String(err) }
  }
}

/** The platform as rooms reach it. */
export const httpPlatform: PlatformPort = {
  verifyPlayToken,
  reportMatch,
  reportRound,
  fetchRoomSeats,
  fetchVipIds,
  markRoom,
}
