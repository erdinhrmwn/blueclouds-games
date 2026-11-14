import type { RoomSummary } from 'server/games/shared/schema';

/** A table as the public list shows it: the API leaves out who sits where. */
type OpenTable = Omit<RoomSummary, 'seats'>;

// ponytail: polling, because browsers can't reach the room list actor. Fine for a lobby list;
// if it needs to be instant, stream it from our server (SSE) instead.
const REFRESH_MS = 5000;

/** One game's open tables, refreshed every few seconds. Create it in the browser only. */
export class RoomList {
	rooms = $state<OpenTable[]>([]);
	status = $state<'loading' | 'ready' | 'error'>('loading');

	#game: string;
	#timer = setInterval(() => void this.#load(), REFRESH_MS);

	constructor(game: string) {
		this.#game = game;
		void this.#load();
	}

	async #load() {
		const url = `/api/${encodeURIComponent(this.#game)}/rooms`;

		try {
			const res = await fetch(url, { cache: 'no-store' });
			if (!res.ok) {
				throw new Error(`room list ${res.status}`);
			}

			const body = (await res.json()) as { rooms: OpenTable[] };
			this.rooms = body.rooms;
			this.status = 'ready';
		} catch (err) {
			console.error('room list failed', err);
			this.status = 'error';
		}
	}

	dispose() {
		clearInterval(this.#timer);
	}
}
