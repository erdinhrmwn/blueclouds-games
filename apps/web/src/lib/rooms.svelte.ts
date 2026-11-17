import type { RoomSummary } from 'contracts/rooms/room'

/** A table as the public list shows it: the API leaves out who sits where. `game` says which game it plays. */
export type OpenTable = Omit<RoomSummary, 'seats'> & { game: string }

// ponytail: polling, one request per game, because browsers can't reach the room list actor. Fine for a
// handful of games; if it needs to be instant or the games grow many, stream one list from our server (SSE).
const REFRESH_MS = 5000

/**
 * The open tables of the given games, refreshed every few seconds. Create it in the browser only.
 * One game failing to answer leaves the others listed; only when every game fails is the list an error.
 */
export class RoomList {
  rooms = $state<OpenTable[]>([])
  status = $state<'loading' | 'ready' | 'error'>('loading')

  #games: string[]
  #timer = setInterval(() => void this.#load(), REFRESH_MS)

  constructor(games: string[]) {
    this.#games = games
    void this.#load()
  }

  async #loadGame(game: string): Promise<OpenTable[]> {
    const url = `/api/${encodeURIComponent(game)}/rooms`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`room list ${game} ${res.status}`)
    }

    const body = (await res.json()) as { rooms: Omit<OpenTable, 'game'>[] }
    return body.rooms.map((room) => ({ ...room, game }))
  }

  async #load() {
    const results = await Promise.allSettled(this.#games.map((game) => this.#loadGame(game)))
    const rooms: OpenTable[] = []
    let failed = 0

    for (const result of results) {
      if (result.status === 'fulfilled') {
        rooms.push(...result.value)
        continue
      }

      failed += 1
      console.error('room list failed', result.reason)
    }

    if (failed === results.length) {
      this.status = 'error'
      return
    }

    this.rooms = rooms
    this.status = 'ready'
  }

  dispose() {
    clearInterval(this.#timer)
  }
}
