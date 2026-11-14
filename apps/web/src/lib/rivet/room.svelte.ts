import type { TournamentFormat } from '#lib/platform.ts';
import { playToken } from '#lib/player.svelte.ts';
import { roomClient, RoomRefused } from '#lib/rivet/client.ts';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'error' | 'refused';
type RoomClient = Awaited<ReturnType<typeof roomClient>>['client'];

/** The code a room refuses with once an admin terminated the table or kicked this player (TABLE_CLOSED in the server). */
const TABLE_CLOSED = 'table_closed';

/** A refusal for good: the table is closed to this player, so reconnecting is pointless. */
const isTableClosed = (err: unknown) =>
	typeof err === 'object' && err !== null && 'code' in err && err.code === TABLE_CLOSED;
/** Every game's room actor has these actions; games add their own on top (see `call`). */
type Conn = {
	join(): Promise<{ playerId: string; view: never; hand: never }>;
	start(): Promise<void>;
	addBot(seat: number): Promise<void>;
	takeSeat(seat: number): Promise<void>;
	removeBot(id: string): Promise<void>;
	kick(seat: number): Promise<void>;
	reset(): Promise<void>;
	leave(): Promise<void>;
	on(event: string, fn: (data: never) => void): () => void;
	onOpen(fn: () => void): () => void;
	onClose(fn: () => void): () => void;
	onError(fn: (e: unknown) => void): () => void;
	dispose(): Promise<void>;
};

/** What every game's public view has, for the shared lobby and room frame. */
export type BaseView = {
	phase: 'lobby' | 'playing' | 'finished';
	hostId: string | null;
	players: {
		id: string;
		name: string;
		bot: boolean;
		seat: number;
		away: boolean;
		vip: boolean;
	}[];
	turnPlayerId: string | null;
	turn: { left: number; total: number } | null;
	round: number;
	/** The table's own name, picked when it was opened; null (or missing from older rooms) for none. */
	roomName?: string | null;
	/** Set at a tournament table: it starts by itself. Times are ms from when the view was sent. */
	tournament: {
		/** Present from rooms made after tournament rounds; older ones leave it out. */
		id?: string;
		name: string;
		/** Arena, Knockout or Swiss; null or missing from older rooms. */
		format?: TournamentFormat | null;
		/** Arena and Swiss: how many rounds it plays; null for Knockout, missing from older rooms. */
		rounds?: number | null;
		/** Everyone still signed up to the tournament, all tables; null or missing from older rooms. */
		registered?: number | null;
		/** The tournament round this table plays in. */
		round?: number;
		startsIn: number;
		waitEndsIn: number;
		seats: number;
		closed: boolean;
	} | null;
	/**
	 * Provably fair rounds: the hash of the round being played (in the lobby: of the next match's first round)
	 * and of the round after it, both locked in before they are dealt; while a match is played also its id and the
	 * client seed of its last shuffle. Null for a match started before provably fair shuffles.
	 */
	fairness: {
		matchId: string | null;
		/** The last match played at this table, whose rounds the dialog still shows once it ended. */
		lastMatchId: string | null;
		round: number;
		serverSeedHash: string;
		clientSeed: string | null;
		nextServerSeedHash: string | null;
	} | null;
};

/**
 * The only place the web app talks to a room actor. Components read its reactive fields.
 * `actor` is the room actor's name in the registry (e.g. `bust31Room`).
 */
export class RoomConnection<View extends BaseView, Hand> {
	view = $state<View | null>(null);
	/** Local epoch ms when the current human turn runs out, or null when no timer runs. */
	turnEndsAt = $state<number | null>(null);
	/** Full length of the current turn timer in ms (bots think for less time than humans get). */
	turnTotal = $state(1);
	/** Local epoch ms when a tournament table starts, and when its wait for late players ends. */
	startsAt = $state<number | null>(null);
	waitEndsAt = $state<number | null>(null);
	hand = $state<Hand>() as Hand;
	playerId = $state<string | null>(null);
	status = $state<Status>('connecting');
	error = $state<string | null>(null);
	busy = $state(false);

	#client: RoomClient | null = null;
	#conn: Conn | null = null;
	#stop: (() => void)[] = [];
	#disposed = false;
	/** Why the last play token couldn't be fetched (e.g. a disabled player), shown instead of the client's wrapper text. */
	#tokenError: string | null = null;

	constructor(
		readonly game: string,
		readonly actor: string,
		code: string,
		emptyHand: Hand
	) {
		this.hand = emptyHand;
		this.#open(code).catch((err) => {
			this.status = err instanceof RoomRefused ? 'refused' : 'error';
			this.error = message(err);
		});
	}

	async #open(code: string) {
		const { client, actorId } = await roomClient(this.game, code);
		this.#client = client;

		// A fresh play token on every (re)connect: they only last 15 minutes.
		const getParams = async () => {
			try {
				this.#tokenError = null;
				return { playToken: await playToken() };
			} catch (err) {
				this.#tokenError = message(err);
				throw err;
			}
		};

		// ponytail: the actor is picked by name, so its typed actions are lost; `Conn` lists the shared ones.
		const handles = client as unknown as Record<string, RoomClient['bust31Room']>;
		const handle = handles[this.actor]!;
		const conn = handle.getForId(actorId, { getParams }).connect() as unknown as Conn;
		this.#conn = conn;

		this.#stop.push(
			conn.on('view', (view: View) => this.#setView(view)),
			conn.on('hand', (hand: Hand) => {
				this.hand = hand;
			}),
			// Sent just before the room closes this connection for good: kicked, or the table was terminated.
			conn.on('closed', (closed: { message: string }) => this.#closed(closed.message)),
			conn.onOpen(() => {
				this.status = 'connected';
				void this.#join();
			}),
			conn.onClose(() => {
				this.status = 'reconnecting';
			}),
			conn.onError((err) => {
				if (isTableClosed(err)) {
					this.#closed(message(err));
					return;
				}

				this.status = 'error';
				this.error = this.#tokenError ?? message(err);
			})
		);

		// The page closed while we were fetching the token.
		if (this.#disposed) {
			await this.dispose();
		}
	}

	/** The room won't take this player again: show why and stop reconnecting. */
	#closed(reason: string) {
		this.status = 'refused';
		this.error = reason;
		void this.dispose();
	}

	get me(): View['players'][number] | null {
		return this.view?.players.find((p) => p.id === this.playerId) ?? null;
	}

	get isHost() {
		return !!this.playerId && this.view?.hostId === this.playerId;
	}

	get myTurn() {
		return !!this.playerId && this.view?.turnPlayerId === this.playerId;
	}

	// Rejoining as the same player is idempotent, so it is safe on every reconnect.
	#join = () =>
		this.#run(async () => {
			const res = await this.#c.join();
			this.playerId = res.playerId;
			this.#setView(res.view as View);
			this.hand = res.hand as Hand;
		});

	// The server sends time left, not a timestamp, so a wrong device clock can't skew the countdown.
	#setView(view: View) {
		const now = Date.now();
		this.view = view;

		this.turnEndsAt = view.turn ? now + view.turn.left : null;
		if (view.turn) {
			this.turnTotal = view.turn.total;
		}

		this.startsAt = view.tournament ? now + view.tournament.startsIn : null;
		this.waitEndsAt = view.tournament ? now + view.tournament.waitEndsIn : null;
	}

	start = () => this.#run(() => this.#c.start());
	addBot = (seat: number) => this.#run(() => this.#c.addBot(seat));
	takeSeat = (seat: number) => this.#run(() => this.#c.takeSeat(seat));
	removeBot = (id: string) => this.#run(() => this.#c.removeBot(id));
	kick = (seat: number) => this.#run(() => this.#c.kick(seat));
	reset = () => this.#run(() => this.#c.reset());
	leave = () => this.#run(() => this.#c.leave());

	/** Calls a game-specific action, with the same busy and error handling as the shared ones. */
	protected call(action: string, ...args: unknown[]): Promise<void> {
		return this.#run(() => {
			const actions = this.#c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
			return actions[action]!(...args);
		});
	}

	async #run(fn: () => Promise<unknown>): Promise<void> {
		this.busy = true;
		this.error = null;
		try {
			await fn();
		} catch (err) {
			this.error = message(err);
		} finally {
			this.busy = false;
		}
	}

	get #c(): Conn {
		if (!this.#conn) {
			throw new Error('Still connecting. Try again in a moment.');
		}

		return this.#conn;
	}

	async dispose(): Promise<void> {
		this.#disposed = true;
		this.#stop.forEach((off) => off());
		this.#stop = [];
		await this.#conn?.dispose();
		await this.#client?.dispose();
	}
}

function message(err: unknown): string {
	if (err instanceof Error && err.message) {
		return err.message;
	}

	return 'Something went wrong. Try again.';
}
