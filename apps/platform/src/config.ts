import { z } from "zod";

const Env = z.object({
	DATABASE_URL: z.string().min(1),
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

export type Config = {
	databaseUrl: string;
	playTokenPrivateKey: string;
	serverKey: string;
	allowedOrigins: string[];
	port: number;
};

/** Reads and checks the environment once at startup; throws a readable error listing every bad key. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = Env.safeParse(env);
	if (!parsed.success) {
		const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
		throw new Error(`Invalid platform config: ${problems}`);
	}
	const e = parsed.data;
	return {
		databaseUrl: e.DATABASE_URL,
		playTokenPrivateKey: e.PLAY_TOKEN_PRIVATE_KEY,
		serverKey: e.PLATFORM_SERVER_KEY,
		allowedOrigins: e.ALLOWED_ORIGINS,
		port: e.PORT,
	};
}
