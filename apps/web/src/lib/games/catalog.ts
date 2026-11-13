import type { Component } from 'svelte';
import * as bust31 from 'server/games/bust-31/rules';
import Bust31Fan from './bust-31/Fan.svelte';
import Bust31Home from './bust-31/Home.svelte';
import Bust31Room from './bust-31/Room.svelte';
import * as cloudburst from 'server/games/cloudburst/rules';
import CloudburstFan from './cloudburst/Fan.svelte';
import CloudburstHome from './cloudburst/Home.svelte';
import CloudburstRoom from './cloudburst/Room.svelte';

export type GameEntry = {
	slug: string;
	name: string;
	tagline: string;
	/** What kind of card game, as in "a shedding card game". */
	kind: string;
	minPlayers: number;
	maxPlayers: number;
	/** A few sample cards: the game's picture. */
	Fan: Component<{ size?: 'sm' | 'md' }>;
	/** The game's own page: rules plus the create/join forms. `maintenance`: no new tables for now. */
	Home: Component<{ game: GameEntry; maintenance: boolean }>;
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
		kind: 'turn-based',
		minPlayers: bust31.MIN_PLAYERS,
		maxPlayers: bust31.MAX_PLAYERS,
		Fan: Bust31Fan,
		Home: Bust31Home,
		Room: Bust31Room
	},
	{
		slug: 'cloudburst',
		name: 'Cloudburst',
		tagline: 'Match the weather, shed your hand first, and keep your cloud from bursting.',
		kind: 'shedding',
		minPlayers: cloudburst.MIN_PLAYERS,
		maxPlayers: cloudburst.MAX_PLAYERS,
		Fan: CloudburstFan,
		Home: CloudburstHome,
		Room: CloudburstRoom
	}
];

export const gameBySlug = (slug: string) => GAMES.find((g) => g.slug === slug);
