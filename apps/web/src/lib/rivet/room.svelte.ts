import { playToken } from '#lib/player.svelte.ts';
import { roomClient } from '#lib/rivet/client.ts';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'error';
type RoomClient = Awaited<ReturnType<typeof roomClient>>['client'];
/** Every game's room actor has these actions; games add their own on top (see `call`). */
type Conn = {
	join(): Promise<{ playerId: string; view: never; hand: never }>;
	start(): Promise<void>;
	addBot(seat: number): Promise<void>;
	takeSeat(seat: number): Promise<void>;
	removeBot(id: string): Promise<void>;
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
	players: { id: string; name: string; bot: boolean; seat: number; away: boolean }[];
	turnPlayerId: string | null;
	turn: { left: number; total: number } | null;
	round: number;
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
		this.#open(code).catch((e) => {
			this.status = 'error';
			this.error = message(e);
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
			} catch (e) {
				this.#tokenError = message(e);
				throw e;
			}
		};
		// ponytail: the actor is picked by name, so its typed actions are lost; `Conn` lists the shared ones.
		const handle = (client as unknown as Record<string, RoomClient['bust31Room']>)[this.actor]!;
		const conn = (this.#conn = handle.getForId(actorId, { getParams }).connect() as unknown as Conn);
		this.#stop.push(
			conn.on('view', (v: View) => this.#setView(v)),
			conn.on('hand', (h: Hand) => (this.hand = h)),
			conn.onOpen(() => {
				this.status = 'connected';
				void this.#join();
			}),
			conn.onClose(() => (this.status = 'reconnecting')),
			conn.onError((e) => {
				this.status = 'error';
				this.error = this.#tokenError ?? message(e);
			})
		);
		if (this.#disposed) await this.dispose(); // the page closed while we were fetching the token
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
	#setView(v: View) {
		this.view = v;
		this.turnEndsAt = v.turn ? Date.now() + v.turn.left : null;
		if (v.turn) this.turnTotal = v.turn.total;
	}

	start = () => this.#run(() => this.#c.start());
	addBot = (seat: number) => this.#run(() => this.#c.addBot(seat));
	takeSeat = (seat: number) => this.#run(() => this.#c.takeSeat(seat));
	removeBot = (id: string) => this.#run(() => this.#c.removeBot(id));
	reset = () => this.#run(() => this.#c.reset());
	leave = () => this.#run(() => this.#c.leave());

	/** Calls a game-specific action, with the same busy and error handling as the shared ones. */
	protected call(action: string, ...args: unknown[]): Promise<void> {
		return this.#run(() => (this.#c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[action]!(...args));
	}

	async #run(fn: () => Promise<unknown>): Promise<void> {
		this.busy = true;
		this.error = null;
		try {
			await fn();
		} catch (e) {
			this.error = message(e);
		} finally {
			this.busy = false;
		}
	}

	get #c(): Conn {
		if (!this.#conn) throw new Error('Still connecting. Try again in a moment.');
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

function message(e: unknown): string {
	return e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.';
}
