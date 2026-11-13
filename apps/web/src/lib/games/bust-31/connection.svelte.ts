import type { Card, PublicView } from 'server/games/bust-31/rules';
import { type BaseView, RoomConnection } from '#lib/rivet/room.svelte.ts';

/** A Bust 31 room: the shared actions plus playing a card. */
export class Bust31Connection extends RoomConnection<
	PublicView & Pick<BaseView, 'tournament' | 'fairness'>,
	Card[]
> {
	constructor(code: string) {
		super('bust-31', 'bust31Room', code, []);
	}
	play = (cardId: string) => this.call('play', { cardId });
}
