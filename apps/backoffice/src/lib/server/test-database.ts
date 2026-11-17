// Test database for the backoffice tests. The schema comes from the platform's own migrations, run as a command
// (`bun run --filter platform db:migrate`), so the backoffice never imports platform code.
import { SQL } from 'bun'

// Postgres 18 has uuidv7() built in. Older test databases get this stand-in (tests only).
const UUIDV7_POLYFILL = `
CREATE FUNCTION uuidv7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING
    substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6),
    52, 1), 53, 1), 'hex')::uuid
$$`

const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname

function testDatabaseName(): string {
  const name = process.env.DATABASE_TEST_NAME
  if (!name) {
    throw new Error('Set DATABASE_TEST_NAME to a throwaway Postgres database to run tests.')
  }

  if (name === process.env.DATABASE_NAME) {
    throw new Error('DATABASE_TEST_NAME must differ from DATABASE_NAME: tests drop its schema.')
  }

  return name
}

/** Empties the test database and runs every platform migration. Its public schema is dropped. */
export async function resetTestDatabase(): Promise<{ sql: SQL }> {
  const database = testDatabaseName()
  const sql = new SQL({
    hostname: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database,
  })

  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  // to_regproc() returns NULL for overloaded names, and PG 18 has uuidv7() and uuidv7(interval).
  const [{ builtin }] = await sql`
		SELECT EXISTS (
			SELECT 1
			FROM pg_proc
			WHERE proname = 'uuidv7' AND pronamespace = 'pg_catalog'::regnamespace
		) AS builtin`
  if (!builtin) {
    await sql.unsafe(UUIDV7_POLYFILL)
  }

  // The process env wins over the script's --env-file, so the migrations run against the test database.
  const migrate = Bun.spawn(['bun', 'run', '--filter', 'platform', 'db:migrate'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_NAME: database },
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if ((await migrate.exited) !== 0) {
    throw new Error(`platform migrations failed: ${await new Response(migrate.stderr).text()}`)
  }

  return { sql }
}

/** A room row for tests that insert matches directly. Returns its id. */
export async function room(sql: SQL, game: string, code: string): Promise<string> {
  const [row] = await sql`
			INSERT INTO rooms (game_slug, code)
			VALUES (${game}, ${code})
			ON CONFLICT (code) DO UPDATE
			SET code = EXCLUDED.code
			RETURNING id`
  return row.id
}
