import type { Card, PublicView } from 'server/games/bust-31/rules';
import { playToken } from '#lib/player.svelte.ts';
import { roomClient } from '#lib/rivet/client.ts';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'error';
type RoomClient = Awaited<ReturnType<typeof roomClient>>['client'];
type Conn = ReturnType<ReturnType<RoomClient['bust31Room']['getForId']>['connect']>;

/** The only place the web app talks to the room actor. Components read its reactive fields. */
export class RoomConnection {
	view = $state<PublicView | null>(null);
	/** Local epoch ms when the current human turn runs out, or null when no timer runs. */
	turnEndsAt = $state<number | null>(null);
	/** Full length of the current turn timer in ms (bots think for less time than humans get). */
	turnTotal = $state(1);
	hand = $state<Card[]>([]);
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

	constructor(code: string) {
		this.#open(code).catch((e) => {
			this.status = 'error';
			this.error = message(e);
		});
	}

	async #open(code: string) {
		const { client, actorId } = await roomClient('bust-31', code);
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
		const conn = (this.#conn = client.bust31Room.getForId(actorId, { getParams }).connect());
		this.#stop.push(
			conn.on('view', (v: PublicView) => this.#setView(v)),
			conn.on('hand', (h: Card[]) => (this.hand = h)),
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

	get me() {
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
			this.#setView(res.view);
			this.hand = res.hand;
		});

	// The server sends time left, not a timestamp, so a wrong device clock can't skew the countdown.
	#setView(v: PublicView) {
		this.view = v;
		this.turnEndsAt = v.turn ? Date.now() + v.turn.left : null;
		if (v.turn) this.turnTotal = v.turn.total;
	}

	start = () => this.#run(() => this.#c.start());
	addBot = (seat: number) => this.#run(() => this.#c.addBot(seat));
	takeSeat = (seat: number) => this.#run(() => this.#c.takeSeat(seat));
	removeBot = (id: string) => this.#run(() => this.#c.removeBot(id));
	play = (cardId: string) => this.#run(() => this.#c.play({ cardId }));
	reset = () => this.#run(() => this.#c.reset());
	leave = () => this.#run(() => this.#c.leave());

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
