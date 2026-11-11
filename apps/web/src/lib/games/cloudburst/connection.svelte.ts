import type { Card, PlayInput, PublicView } from 'server/games/cloudburst/rules';
import { type BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';

export type Hand = { cards: Card[]; drawnId: string | null };

/** A Cloudburst room: the shared actions plus play, draw and pass. */
export class CloudburstConnection extends RoomConnection<PublicView & Pick<BaseView, 'tournament'>, Hand> {
	constructor(code: string) {
		super('cloudburst', 'cloudburstRoom', code, { cards: [], drawnId: null });
	}
	play = (input: PlayInput) => this.call('play', input);
	draw = () => this.call('draw');
	pass = () => this.call('pass');
}
