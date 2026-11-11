import { z } from "zod";

const DbEnv = z.object({
	DB_HOST: z.string().min(1),
	DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
	DB_USER: z.string().min(1),
	/** Empty is allowed for local servers that trust local connections. */
	DB_PASSWORD: z.string().default(""),
	DB_NAME: z.string().min(1),
});

const Env = DbEnv.extend({
	/** Ed25519 private key as a JWK (JSON). `bun run keys:generate` prints one. */
	PLAY_TOKEN_PRIVATE_KEY: z.string().min(1),
	/** Bearer key the actor server sends with match reports. */
	PLATFORM_SERVER_KEY: z.string().min(32, "must be at least 32 characters"),
	/** Comma-separated browser origins allowed by CORS. */
	ALLOWED_ORIGINS: z
		.string()
		.transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean))
		.pipe(z.array(z.url()).min(1)),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

/** Connection options in the shape `new SQL(...)` takes. */
export type DbConfig = { hostname: string; port: number; username: string; password: string; database: string };

export type Config = {
	db: DbConfig;
	playTokenPrivateKey: string;
	serverKey: string;
	allowedOrigins: string[];
	port: number;
};

type RawEnv = Record<string, string | undefined>;

function check<S extends z.ZodType>(schema: S, env: RawEnv, what: string): z.output<S> {
	const parsed = schema.safeParse(env);
	if (parsed.success) return parsed.data;
	const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
	throw new Error(`Invalid ${what}: ${problems}`);
}

const toDb = (e: z.output<typeof DbEnv>): DbConfig => ({
	hostname: e.DB_HOST,
	port: e.DB_PORT,
	username: e.DB_USER,
	password: e.DB_PASSWORD,
	database: e.DB_NAME,
});

/** Only the database settings, for scripts such as `db:migrate`. */
export const loadDbConfig = (env: RawEnv = process.env): DbConfig => toDb(check(DbEnv, env, "database config"));

/** Reads and checks the environment once at startup; throws a readable error listing every bad key. */
export function loadConfig(env: RawEnv = process.env): Config {
	const e = check(Env, env, "platform config");
	return {
		db: toDb(e),
		playTokenPrivateKey: e.PLAY_TOKEN_PRIVATE_KEY,
		serverKey: e.PLATFORM_SERVER_KEY,
		allowedOrigins: e.ALLOWED_ORIGINS,
		port: e.PORT,
	};
}
