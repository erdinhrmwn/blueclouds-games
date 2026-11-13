import type { SQL } from 'bun';
import { type Admin, audit } from './auth.ts';

export type GameRow = {
	slug: string;
	name: string;
	minPlayers: number;
	maxPlayers: number;
	maintenanceAt: Date | null;
};

/** Every game, with whether it is under maintenance (since when). */
export async function listGames(sql: SQL): Promise<GameRow[]> {
	const rows = await sql`
		SELECT
			g.slug,
			g.name,
			g.min_players AS "minPlayers",
			g.max_players AS "maxPlayers",
			g.maintenance_at AS "maintenanceAt"
		FROM games g
		ORDER BY g.name`;

	return rows as GameRow[];
}

/**
 * Starts or ends a game's maintenance, with its audit row. While it runs, nobody opens a new table or tournament
 * for the game; tables already open play on. Returns false when it already was in that state.
 */
export async function setMaintenance(
	sql: SQL,
	admin: Admin,
	slug: string,
	on: boolean,
	ip: string | null
): Promise<boolean> {
	return sql.begin(async (tx) => {
		const rows = on
			? await tx`
				UPDATE games
				SET maintenance_at = now()
				WHERE slug = ${slug} AND maintenance_at IS NULL
				RETURNING slug`
			: await tx`
				UPDATE games
				SET maintenance_at = NULL
				WHERE slug = ${slug} AND maintenance_at IS NOT NULL
				RETURNING slug`;

		if (rows.length === 0) {
			return false;
		}

		await audit(tx, {
			adminId: admin.id,
			action: on ? 'game.maintenance_start' : 'game.maintenance_end',
			detail: { game: slug },
			ip
		});

		return true;
	});
}
