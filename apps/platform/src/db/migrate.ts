import type { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");
const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/;

/** Applies every `NNN_name.sql` not yet in `schema_migrations`, in order, each in its own transaction. */
export async function migrate(sql: SQL, dir = MIGRATIONS_DIR): Promise<string[]> {
	await sql`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`;

	const doneRows = await sql`SELECT name FROM schema_migrations`;
	const done = new Set(doneRows.map((row: { name: string }) => row.name));

	const allFiles = await readdir(dir);
	const files = allFiles.filter((file) => MIGRATION_FILE.test(file)).sort();

	const applied: string[] = [];
	for (const file of files) {
		if (done.has(file)) continue;

		const text = await Bun.file(join(dir, file)).text();
		await sql.begin(async (tx) => {
			await tx.unsafe(text);
			await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
		});
		applied.push(file);
	}

	return applied;
}
