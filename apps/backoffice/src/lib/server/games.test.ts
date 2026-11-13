import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { resetTestDatabase } from '../../../../platform/src/test-helpers';
import { type Admin, createAdmin } from './auth';
import { listGames, setMaintenance } from './games';
import { createTournament, TournamentError } from './tournaments';

let sql: SQL;
let admin: Admin;
beforeAll(async () => {
	sql = (await resetTestDatabase()).sql;
	admin = {
		id: await createAdmin(sql, 'root', 'correct horse battery'),
		username: 'root',
		role: 'owner'
	};
});
afterAll(() => sql.close());

const maintenanceOf = async (slug: string) =>
	(await listGames(sql)).find((game) => game.slug === slug)!.maintenanceAt;

test('maintenance starts and ends once each, audited, and blocks new tournaments meanwhile', async () => {
	expect(await setMaintenance(sql, admin, 'cloudburst', true, '10.0.0.1')).toBe(true);
	expect(await setMaintenance(sql, admin, 'cloudburst', true, '10.0.0.1')).toBe(false);
	expect(await maintenanceOf('cloudburst')).toBeInstanceOf(Date);
	expect(await maintenanceOf('bust-31')).toBeNull();

	const startsAt = new Date(Date.now() + 3_600_000);
	const input = {
		game: 'cloudburst',
		name: 'Friday cup',
		playersPerRoom: 4,
		minPlayers: 4,
		maxPlayers: 16,
		format: 'knockout' as const,
		description: null,
		prizes: [],
		fee: 0,
		startsAt
	};
	await expect(createTournament(sql, admin, input, null)).rejects.toThrow(TournamentError);

	expect(await setMaintenance(sql, admin, 'cloudburst', false, '10.0.0.1')).toBe(true);
	expect(await maintenanceOf('cloudburst')).toBeNull();
	expect(await createTournament(sql, admin, input, null)).toBeString();

	const rows = await sql`
		SELECT action, detail
		FROM admin_audit_events
		WHERE action LIKE 'game.%'
		ORDER BY id`;
	expect(rows).toEqual([
		{ action: 'game.maintenance_start', detail: { game: 'cloudburst' } },
		{ action: 'game.maintenance_end', detail: { game: 'cloudburst' } }
	]);
});
