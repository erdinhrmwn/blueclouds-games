import type { RoomSummary } from 'server/games/shared/schema';

// ponytail: polling, because browsers can't reach the room list actor. Fine for a lobby list;
// if it needs to be instant, stream it from our server (SSE) instead.
const REFRESH_MS = 5000;

/** One game's open tables, refreshed every few seconds. Create it in the browser only. */
export class RoomList {
	rooms = $state<RoomSummary[]>([]);
	status = $state<'loading' | 'ready' | 'error'>('loading');

	#game: string;
	#timer = setInterval(() => void this.#load(), REFRESH_MS);

	constructor(game: string) {
		this.#game = game;
		void this.#load();
	}

	async #load() {
		try {
			const res = await fetch(`/api/${encodeURIComponent(this.#game)}/rooms`, {
				cache: 'no-store'
			});
			if (!res.ok) throw new Error(`room list ${res.status}`);
			this.rooms = ((await res.json()) as { rooms: RoomSummary[] }).rooms;
			this.status = 'ready';
		} catch (e) {
			console.error('room list failed', e);
			this.status = 'error';
		}
	}

	dispose() {
		clearInterval(this.#timer);
	}
}
