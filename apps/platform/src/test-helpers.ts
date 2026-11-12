import { SQL } from "bun";
import { exportJWK, generateKeyPair } from "jose";
import { createApp } from "./app";
import { type Config, loadDbConfig } from "./config";
import { migrate } from "./db/migrate";
import { createSigner } from "./lib/play-tokens";

// Postgres 18 has uuidv7() built in. Older test databases get this stand-in (tests only).
const UUIDV7_POLYFILL = `
CREATE FUNCTION uuidv7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING
    substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6),
    52, 1), 53, 1), 'hex')::uuid
$$`;

/** Creates a guest and returns its secret, for tests that need a signed-in player. */
export async function guest(app: App, name = "Rina") {
	const res = await call(app, "POST", "/v1/players/guest", { body: { name }, headers: { "x-forwarded-for": crypto.randomUUID() } });
	return { player: res.json.data.player as { id: string; name: string }, secret: res.json.data.playerSecret as string };
}

export const SERVER_KEY = "test-server-key-0123456789abcdef0123";

/** A room row for tests that report matches or insert them directly. Returns its id. */
export async function room(sql: SQL, game: string, code: string): Promise<string> {
	const [row] = await sql`INSERT INTO rooms (game_slug, code) VALUES (${game}, ${code}) ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`;
	return row.id;
}

/**
 * Empties the test database and runs every migration. Also used by the backoffice tests.
 * DATABASE_TEST_NAME must be a throwaway database: its public schema is dropped.
 */
export async function resetTestDatabase() {
	const name = process.env.DATABASE_TEST_NAME;
	if (!name) throw new Error("Set DATABASE_TEST_NAME to a throwaway Postgres database to run tests.");
	if (name === process.env.DATABASE_NAME) throw new Error("DATABASE_TEST_NAME must differ from DATABASE_NAME: tests drop its schema.");
	const db = { ...loadDbConfig(), database: name };
	const sql = new SQL(db);
	await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
	// to_regproc() returns NULL for overloaded names, and PG 18 has uuidv7() and uuidv7(interval).
	const [{ builtin }] = await sql`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uuidv7' AND pronamespace = 'pg_catalog'::regnamespace) AS builtin`;
	if (!builtin) await sql.unsafe(UUIDV7_POLYFILL);
	await migrate(sql);
	return { sql, db };
}

/**
 * Fresh schema + app for one test file. Uses the DATABASE_* settings with DATABASE_TEST_NAME as the
 * database, which must be a throwaway one: its public schema is dropped.
 */
export async function setupTestApp() {
	const { sql, db } = await resetTestDatabase();

	const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
	const config: Config = {
		db,
		playTokenPrivateKey: (await exportJWK(privateKey)).d!,
		serverKey: SERVER_KEY,
		host: "127.0.0.1",
		port: 0,
	};
	const app = createApp({ sql, config, signer: await createSigner(config.playTokenPrivateKey) });
	return { sql, app, publicKey };
}

type App = Awaited<ReturnType<typeof setupTestApp>>["app"];

/** Sends a JSON request and returns the status plus the parsed envelope. */
export async function call(app: App, method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
	const headers: Record<string, string> = { ...opts.headers };
	if (opts.body !== undefined) headers["content-type"] = "application/json";
	if (opts.token) headers.authorization = `Bearer ${opts.token}`;
	const res = await app.request(path, {
		method,
		headers,
		body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
	});
	return { status: res.status, headers: res.headers, json: (await res.json()) as any };
}
