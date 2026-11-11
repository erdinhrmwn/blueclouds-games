import type { Component } from 'svelte';
import * as bust31 from 'server/games/bust-31/rules';
import Bust31Home from './bust-31/Home.svelte';
import Bust31Room from './bust-31/Room.svelte';
import * as cloudburst from 'server/games/cloudburst/rules';
import CloudburstHome from './cloudburst/Home.svelte';
import CloudburstRoom from './cloudburst/Room.svelte';

export type GameEntry = {
	slug: string;
	name: string;
	tagline: string;
	minPlayers: number;
	maxPlayers: number;
	/** Landing page: rules plus the create/join forms. */
	Home: Component<{ game: GameEntry }>;
	/** Everything inside a room: lobby, table, connection. */
	Room: Component<{ game: GameEntry; code: string }>;
};

// ponytail: every game's components load up front. Fine for a handful of games;
// switch Home/Room to `() => import(...)` once the bundle gets heavy.
export const GAMES: GameEntry[] = [
	{
		slug: 'bust-31',
		name: 'Bust 31',
		tagline: 'Play a card, add to the total, and don’t be the one who goes over 31.',
		minPlayers: bust31.MIN_PLAYERS,
		maxPlayers: bust31.MAX_PLAYERS,
		Home: Bust31Home,
		Room: Bust31Room
	},
	{
		slug: 'cloudburst',
		name: 'Cloudburst',
		tagline: 'Match the weather, shed your hand first, and keep your cloud from bursting.',
		minPlayers: cloudburst.MIN_PLAYERS,
		maxPlayers: cloudburst.MAX_PLAYERS,
		Home: CloudburstHome,
		Room: CloudburstRoom
	}
];

export const gameBySlug = (slug: string) => GAMES.find((g) => g.slug === slug);
