import type { z } from 'zod'

/** The request's JSON body read by `schema`, or null when it isn't JSON or doesn't fit. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S> | null> {
  const body: unknown = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)

  return parsed.success ? parsed.data : null
}
