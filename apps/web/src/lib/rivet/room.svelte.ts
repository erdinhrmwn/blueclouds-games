import {
  type BaseView,
  type ClosedEvent,
  type RoomActions,
  TABLE_CLOSED,
} from 'contracts/rooms/room'
import type { ActorConnRaw } from 'rivetkit/client'
import { playToken } from '#lib/player.svelte.ts'
import { RoomRefused, roomClient } from '#lib/rivet/client.ts'

type Status = 'connecting' | 'connected' | 'reconnecting' | 'error' | 'refused'
type RoomClient = Awaited<ReturnType<typeof roomClient>>['client']
/**
 * An untyped connection. Its type drops `on` because the actor definition is unknown here, but every connection
 * has it (ActorConnRaw); the listeners below type their own payloads from the contract.
 */
type Conn = ReturnType<ReturnType<RoomClient['getForId']>['connect']> & Pick<ActorConnRaw, 'on'>
/** A room's actions as the contract lists them; each one takes plain data and returns a promise. */
type ActionMap<Actions> = Record<keyof Actions, (...args: never[]) => Promise<unknown>>

/** A refusal for good: the table is closed to this player, so reconnecting is pointless. */
const isTableClosed = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === TABLE_CLOSED

/**
 * The only place the web app talks to a room actor. Components read its reactive fields.
 * `actor` is the room actor's name in the registry (e.g. `bust31Room`); `Actions` is its contract, so a
 * game's own moves are typed too (see `call`).
 */
export class RoomConnection<
  View extends BaseView,
  Hand,
  Actions extends RoomActions<View, Hand> & ActionMap<Actions> = RoomActions<View, Hand>,
> {
  view = $state<View | null>(null)
  /** Local epoch ms when the current human turn runs out, or null when no timer runs. */
  turnEndsAt = $state<number | null>(null)
  /** Full length of the current turn timer in ms (bots think for less time than humans get). */
  turnTotal = $state(1)
  /** Local epoch ms when a tournament table starts, and when its wait for late players ends. */
  startsAt = $state<number | null>(null)
  waitEndsAt = $state<number | null>(null)
  hand = $state<Hand>() as Hand
  playerId = $state<string | null>(null)
  status = $state<Status>('connecting')
  error = $state<string | null>(null)
  busy = $state(false)

  #client: RoomClient | null = null
  #conn: Conn | null = null
  #stop: (() => void)[] = []
  #disposed = false
  /** Why the last play token couldn't be fetched (e.g. a disabled player), shown instead of the client's wrapper text. */
  #tokenError: string | null = null

  constructor(
    readonly game: string,
    readonly actor: string,
    code: string,
    emptyHand: Hand,
  ) {
    this.hand = emptyHand
    this.#open(code).catch((err) => {
      this.status = err instanceof RoomRefused ? 'refused' : 'error'
      this.error = message(err)
    })
  }

  async #open(code: string) {
    const { client, actorId } = await roomClient(this.game, code)
    this.#client = client

    // A fresh play token on every (re)connect: they only last 15 minutes.
    const getParams = async () => {
      try {
        this.#tokenError = null
        return { playToken: await playToken() }
      } catch (err) {
        this.#tokenError = message(err)
        throw err
      }
    }

    // The client is untyped (web never imports the game server); `call` and the listeners below
    // take their types from the room's contract instead.
    const conn: Conn = client.getForId(this.actor, actorId, { getParams }).connect() as Conn
    this.#conn = conn

    this.#stop.push(
      conn.on<[View]>('view', (view) => this.#setView(view)),
      conn.on<[Hand]>('hand', (hand) => {
        this.hand = hand
      }),
      // Sent just before the room closes this connection for good: kicked, or the table was terminated.
      conn.on<[ClosedEvent]>('closed', (closed) => this.#closed(closed.message)),
      conn.onOpen(() => {
        this.status = 'connected'
        void this.#join()
      }),
      conn.onClose(() => {
        this.status = 'reconnecting'
      }),
      conn.onError((err) => {
        if (isTableClosed(err)) {
          this.#closed(message(err))
          return
        }

        this.status = 'error'
        this.error = this.#tokenError ?? message(err)
      }),
    )

    // The page closed while we were fetching the token.
    if (this.#disposed) {
      await this.dispose()
    }
  }

  /** The room won't take this player again: show why and stop reconnecting. */
  #closed(reason: string) {
    this.status = 'refused'
    this.error = reason
    void this.dispose()
  }

  get me(): View['players'][number] | null {
    return this.view?.players.find((player) => player.id === this.playerId) ?? null
  }

  get isHost() {
    return !!this.playerId && this.view?.hostId === this.playerId
  }

  get myTurn() {
    return !!this.playerId && this.view?.turnPlayerId === this.playerId
  }

  // Rejoining as the same player is idempotent, so it is safe on every reconnect.
  #join = () =>
    this.#run(async () => {
      const res = await this.#shared('join')
      this.playerId = res.playerId
      this.#setView(res.view)
      this.hand = res.hand
    })

  // The server sends time left, not a timestamp, so a wrong device clock can't skew the countdown.
  #setView(view: View) {
    const now = Date.now()
    this.view = view

    this.turnEndsAt = view.turn ? now + view.turn.left : null
    if (view.turn) {
      this.turnTotal = view.turn.total
    }

    this.startsAt = view.tournament ? now + view.tournament.startsIn : null
    this.waitEndsAt = view.tournament ? now + view.tournament.waitEndsIn : null
  }

  start = () => this.#run(() => this.#shared('start'))
  addBot = (seat: number) => this.#run(() => this.#shared('addBot', seat))
  takeSeat = (seat: number) => this.#run(() => this.#shared('takeSeat', seat))
  removeBot = (id: string) => this.#run(() => this.#shared('removeBot', id))
  kick = (seat: number) => this.#run(() => this.#shared('kick', seat))
  reset = () => this.#run(() => this.#shared('reset'))
  leave = () => this.#run(() => this.#shared('leave'))

  /** Calls one of the game's own actions, with the same busy and error handling as the shared ones. */
  protected call<Name extends keyof Actions & string>(
    name: Name,
    ...args: Parameters<Actions[Name]>
  ): Promise<void> {
    return this.#run(() => this.#connection.action({ name, args }))
  }

  /** One of the actions every room has, typed by the contract. */
  #shared<Name extends keyof RoomActions<View, Hand>>(
    name: Name,
    ...args: Parameters<RoomActions<View, Hand>[Name]>
  ): Promise<Awaited<ReturnType<RoomActions<View, Hand>[Name]>>> {
    return this.#connection.action({ name, args })
  }

  async #run(fn: () => Promise<unknown>): Promise<void> {
    this.busy = true
    this.error = null
    try {
      await fn()
    } catch (err) {
      this.error = message(err)
    } finally {
      this.busy = false
    }
  }

  get #connection(): Conn {
    if (!this.#conn) {
      throw new Error('Still connecting. Try again in a moment.')
    }

    return this.#conn
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    for (const off of this.#stop) {
      off()
    }

    this.#stop = []
    await this.#conn?.dispose()
    await this.#client?.dispose()
  }
}

function message(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message
  }

  return 'Something went wrong. Try again.'
}
