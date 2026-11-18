// The game's server side of the platform: the browser calls our /api routes, and these modules call the platform
// over the internal network. This one sends a request and reads its answer; the player secret lives only in an
// httpOnly cookie (session.ts).

import { json, type RequestEvent } from '@sveltejs/kit'
import {
  type ClientRequestOptions,
  type ClientResponse,
  hc,
  type InferResponseType,
} from 'hono/client'
import type { AppType } from 'platform/rpc'
import { PLATFORM_URL } from '$app/env/private'
import { log } from '../log.ts'

const TIMEOUT_MS = 5_000

/** The platform's API, typed by its routes (AppType): paths, inputs and answers can't drift from it. */
export const platform = hc<AppType>(PLATFORM_URL).v1

/** What a route answers on success. Errors are the same envelope for every route (see `call`). */
interface Ok<T> {
  ok: true
  data: T
}

interface Failed {
  ok: false
  error: { code: string; message: string; fields?: Record<string, string> }
}

type Envelope<T> = Ok<T> | Failed

export type Answer<T> = ClientResponse<Ok<T>, number, 'json'>

/** The `data` a platform route answers with. */
export type Data<Route extends (...args: never[]) => unknown> = InferResponseType<Route>['data']

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

/**
 * Sends one request to the platform: `send` makes it with the options given here (who asks, the timeout).
 * Answers the route's data, or throws a PlatformError with the platform's own code and message.
 */
async function call<T>(
  event: RequestEvent,
  secret: string | undefined,
  send: (options: ClientRequestOptions) => Promise<Answer<T>>,
): Promise<T> {
  const headers: Record<string, string> = {
    // The platform rate-limits guests by IP; it trusts this header because only we can reach it.
    'X-Forwarded-For': event.getClientAddress(),
  }
  if (secret) {
    headers.Authorization = `Bearer ${secret}`
  }

  let res: Answer<T>
  try {
    res = await send({ headers, init: { signal: AbortSignal.timeout(TIMEOUT_MS) } })
  } catch (err) {
    log.error({ msg: 'platform unreachable', err })
    throw new PlatformError(503, 'unavailable', 'The game server is busy. Try again in a moment.')
  }

  const body = await envelopeOf(res)
  if (body?.ok) {
    return body.data
  }

  throw new PlatformError(
    res.status,
    body?.error.code ?? 'internal',
    body?.error.message ?? 'Something went wrong. Try again.',
    body?.error.fields,
  )
}

/** The answer's envelope: a route's types know only its success, but any answer may be an error. */
function envelopeOf<T>(res: Answer<T>): Promise<Envelope<T> | null> {
  return res.json().catch(() => null)
}

/** A path segment, as the platform's routes take it. */
export const segment = (value: string) => encodeURIComponent(value)

/** An error answer in the same `{ error: { code, message } }` shape as `failure`. */
export function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status })
}

export const BUSY_MESSAGE = 'The game server is busy. Try again in a moment.'

/** Same `{ error: { code, message } }` shape for every failure the browser sees. */
export function failure(err: unknown) {
  if (!(err instanceof PlatformError)) {
    throw err
  }

  const error = { code: err.code, message: err.message, fields: err.fields }
  return json({ error }, { status: err.status })
}

/**
 * How the game's server reaches the platform: one typed request at a time, as one player (their secret) or as
 * nobody. The area modules (session, rooms, tournaments, history) only use this.
 */
export interface PlatformClient {
  call<T>(
    event: RequestEvent,
    secret: string | undefined,
    send: (options: ClientRequestOptions) => Promise<Answer<T>>,
  ): Promise<T>
}

/** The platform over the internal network. */
export const platformClient: PlatformClient = { call }
