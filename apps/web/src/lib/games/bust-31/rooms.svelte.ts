import { client } from '#lib/rivet/client.ts';
import type { RoomSummary } from 'server/games/bust-31/schema';

/** Live list of open Bust 31 tables. Create it in the browser only (it opens a WebSocket). */
export class RoomList {
	rooms = $state<RoomSummary[]>([]);
	status = $state<'loading' | 'ready' | 'error'>('loading');

	#conn = client.bust31Rooms.getOrCreate(['main']).connect();
	#stop: (() => void)[] = [];

	constructor() {
		this.#stop.push(
			this.#conn.on('rooms', (rooms: RoomSummary[]) => (this.rooms = rooms)),
			this.#conn.onOpen(() => void this.#load()),
			this.#conn.onError(() => (this.status = 'error'))
		);
	}

	async #load() {
		try {
			this.rooms = await this.#conn.list();
			this.status = 'ready';
		} catch (e) {
			console.error('room list failed', e);
			this.status = 'error';
		}
	}

	dispose() {
		for (const stop of this.#stop) stop();
		void this.#conn.dispose();
	}
}
