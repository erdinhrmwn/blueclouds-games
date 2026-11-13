import type { SQL } from "bun";
import { ApiError } from "../lib/http";

export type GameStatus = {
	slug: string;
	name: string;
	minPlayers: number;
	maxPlayers: number;
	maintenance: boolean;
};

/** The game catalog with whether each game is under maintenance (no new tables or tournaments). */
export async function listGames(sql: SQL): Promise<GameStatus[]> {
	const rows = await sql`
		SELECT
			slug,
			name,
			min_players,
			max_players,
			maintenance_at IS NOT NULL AS maintenance
		FROM games
		ORDER BY name`;

	return rows.map((row: any) => ({
		slug: row.slug,
		name: row.name,
		minPlayers: row.min_players,
		maxPlayers: row.max_players,
		maintenance: row.maintenance,
	}));
}

/** Refuses an unknown game, and a game under maintenance: nobody opens a new table for it then. */
export async function requirePlayable(sql: SQL, slug: string): Promise<void> {
	const [game] = await sql`
		SELECT name, maintenance_at
		FROM games
		WHERE slug = ${slug}`;

	if (!game) {
		throw new ApiError("bad_input", 400, "Some fields are invalid.", { game: "Unknown game." });
	}

	if (game.maintenance_at) {
		throw new ApiError(
			"under_maintenance",
			409,
			`${game.name} is under maintenance. New tables are paused; try again later.`,
		);
	}
}
