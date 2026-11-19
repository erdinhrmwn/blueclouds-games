/**
 * The value, or a thrown error when it is missing. For lookups the code's own invariants already
 * guarantee (an index inside the list, a player who is at the table), in place of a `!` that would
 * let `undefined` through silently.
 */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${what}`)
  }

  return value
}
