import type { Card, PublicView } from 'server/games/bust-31/rules';
import { client } from '#lib/rivet/client.ts';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'error';

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

	#conn;
	#stop: (() => void)[] = [];

	constructor(code: string, token: string, name: string) {
		this.#conn = client.bust31Room.getOrCreate([code]).connect({ token, name });
		this.#stop.push(
			this.#conn.on('view', (v: PublicView) => this.#setView(v)),
			this.#conn.on('hand', (h: Card[]) => (this.hand = h)),
			this.#conn.onOpen(() => {
				this.status = 'connected';
				void this.#join();
			}),
			this.#conn.onClose(() => (this.status = 'reconnecting')),
			this.#conn.onError((e) => {
				this.status = 'error';
				this.error = message(e);
			})
		);
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

	// Rejoining with the same token is idempotent, so it is safe on every reconnect.
	#join = () =>
		this.#run(async () => {
			const res = await this.#conn.join();
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

	start = () => this.#run(() => this.#conn.start());
	addBot = (seat: number) => this.#run(() => this.#conn.addBot(seat));
	takeSeat = (seat: number) => this.#run(() => this.#conn.takeSeat(seat));
	removeBot = (id: string) => this.#run(() => this.#conn.removeBot(id));
	play = (cardId: string) => this.#run(() => this.#conn.play({ cardId }));
	reset = () => this.#run(() => this.#conn.reset());
	leave = () => this.#run(() => this.#conn.leave());

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

	async dispose(): Promise<void> {
		this.#stop.forEach((off) => off());
		await this.#conn.dispose();
	}
}

function message(e: unknown): string {
	return e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.';
}
