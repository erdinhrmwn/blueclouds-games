import { z } from "zod";

/** A raw 32-byte Ed25519 key in base64url, as `bun run --filter platform keys:generate` prints it. */
const Ed25519Key = z
	.string()
	.regex(
		/^[A-Za-z0-9_-]{43}$/,
		"must be a 43-character base64url Ed25519 key; run `bun run --filter platform keys:generate`",
	);

const DbEnv = z.object({
	DATABASE_HOST: z.string().min(1),
	DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
	DATABASE_USER: z.string().min(1),
	/** Empty is allowed for local servers that trust local connections. */
	DATABASE_PASSWORD: z.string().default(""),
	DATABASE_NAME: z.string().min(1),
});

const Env = DbEnv.extend({
	/** Ed25519 private key (32-byte seed, base64url) that signs play tokens. */
	PLAY_TOKEN_PRIVATE_KEY: Ed25519Key,
	/** Bearer key the actor server sends with match reports. */
	PLATFORM_SERVER_KEY: z.string().min(32, "must be at least 32 characters"),
	/** Interface to listen on. 127.0.0.1 = this machine only; use 0.0.0.0 inside a container. */
	PLATFORM_HOST: z.string().min(1).default("127.0.0.1"),
	PLATFORM_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

/** Connection options in the shape `new SQL(...)` takes. */
export type DbConfig = {
	hostname: string;
	port: number;
	username: string;
	password: string;
	database: string;
};

export type Config = {
	db: DbConfig;
	playTokenPrivateKey: string;
	serverKey: string;
	host: string;
	port: number;
};

type RawEnv = Record<string, string | undefined>;

function check<S extends z.ZodType>(schema: S, env: RawEnv, what: string): z.output<S> {
	const parsed = schema.safeParse(env);
	if (parsed.success) {
		return parsed.data;
	}

	const problems = parsed.error.issues
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("; ");

	throw new Error(`Invalid ${what}: ${problems}`);
}

const toDb = (env: z.output<typeof DbEnv>): DbConfig => ({
	hostname: env.DATABASE_HOST,
	port: env.DATABASE_PORT,
	username: env.DATABASE_USER,
	password: env.DATABASE_PASSWORD,
	database: env.DATABASE_NAME,
});

/** Only the database settings, for scripts such as `db:migrate`. */
export const loadDbConfig = (env: RawEnv = process.env): DbConfig =>
	toDb(check(DbEnv, env, "database config"));

/** Reads and checks the environment once at startup; throws a readable error listing every bad key. */
export function loadConfig(env: RawEnv = process.env): Config {
	const parsed = check(Env, env, "platform config");

	return {
		db: toDb(parsed),
		playTokenPrivateKey: parsed.PLAY_TOKEN_PRIVATE_KEY,
		serverKey: parsed.PLATFORM_SERVER_KEY,
		host: parsed.PLATFORM_HOST,
		port: parsed.PLATFORM_PORT,
	};
}
