// Layer 1, domain: ids that are plain strings at runtime but must never be mixed up. A player id and a match id are
// both UUIDs, so only their types tell them apart. Values get their brand once, where they enter the server (a
// play token, the platform's answer, the room's own store, a new id), through the two functions below.

declare const brand: unique symbol

/** A string that has been checked to be a `Name`. */
type Branded<Name extends string> = string & { readonly [brand]: Name }

/** A player: their platform account id (UUIDv7), or `bot-…` for a bot a host seated. */
export type PlayerId = Branded<'PlayerId'>

/** A match, made by the room when the match is committed to (UUIDv7). */
export type MatchId = Branded<'MatchId'>

/** Only where an id enters the server, after it was checked (or made). */
export const toPlayerId = (id: string): PlayerId => id as PlayerId

/** Only where an id enters the server, after it was checked (or made). */
export const toMatchId = (id: string): MatchId => id as MatchId
