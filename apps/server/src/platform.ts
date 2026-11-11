import { importJWK, jwtVerify } from "jose";
import { z } from "zod";

/**
 * Everything the actor server needs from the BlueClouds Platform, in one place, so another
 * platform could replace it later. Reads its config from env on first use.
 */

/** Must match the platform's PLAY_TOKEN_AUDIENCE. */
const PLAY_TOKEN_AUDIENCE = "blueclouds-rooms";

const Env = z.object({
	/** Ed25519 public JWK (JSON) matching the platform's PLAY_TOKEN_PRIVATE_KEY. */
	PLAY_TOKEN_PUBLIC_KEY: z.string().min(1),
	/** Where the actor server reaches the platform API (server to server, not the public URL). */
	PLATFORM_URL: z.url().default("http://127.0.0.1:3000").transform((u) => u.replace(/\/+$/, "")),
	/** Bearer key for match reports; same value as the platform's. */
	PLATFORM_SERVER_KEY: z.string().min(32, "must be at least 32 characters"),
});
type Env = z.output<typeof Env>;

const REPORT_TIMEOUT_MS = 5_000;

const Claims = z.object({ sub: z.uuid(), name: z.string().trim().min(1).max(20) });
export type Identity = { id: string; name: string };

let publicKey: Promise<CryptoKey | Uint8Array> | undefined;
let config: Env | undefined;

/** Validates the env once; call at boot so a bad config fails fast. */
export function loadPlatformConfig(env: Record<string, string | undefined> = process.env) {
	const parsed = Env.safeParse(env);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
		throw new Error(`Invalid actor server config: ${issues}`);
	}
	let jwk: Record<string, unknown>;
	try {
		jwk = JSON.parse(parsed.data.PLAY_TOKEN_PUBLIC_KEY);
	} catch {
		throw new Error("PLAY_TOKEN_PUBLIC_KEY must be a JSON JWK");
	}
	if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || "d" in jwk) {
		throw new Error("PLAY_TOKEN_PUBLIC_KEY must be an Ed25519 public JWK");
	}
	publicKey = importJWK(jwk, "EdDSA");
	config = parsed.data;
	return config;
}

/** Checks a play token from the platform. Returns who it belongs to, or null if it isn't valid. */
export async function verifyPlayToken(token: unknown): Promise<Identity | null> {
	if (typeof token !== "string" || token.length > 2048) return null;
	if (!publicKey) loadPlatformConfig();
	try {
		const { payload } = await jwtVerify(token, await publicKey!, { audience: PLAY_TOKEN_AUDIENCE, algorithms: ["EdDSA"] });
		const claims = Claims.safeParse(payload);
		return claims.success ? { id: claims.data.sub, name: claims.data.name } : null;
	} catch {
		return null;
	}
}

/**
 * Sends a finished match. "sent": stored (or already stored, the platform is idempotent by matchId).
 * "rejected": the platform will never accept this body, so retrying is pointless. "retry": try again later.
 */
export async function reportMatch(report: { matchId: string }): Promise<{ result: "sent" | "rejected" | "retry"; detail?: string }> {
	const { PLATFORM_URL, PLATFORM_SERVER_KEY } = config ?? loadPlatformConfig();
	try {
		const res = await fetch(`${PLATFORM_URL}/v1/matches`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${PLATFORM_SERVER_KEY}` },
			body: JSON.stringify(report),
			signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
		});
		if (res.ok) return { result: "sent" };
		const detail = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
		return { result: [400, 409, 422].includes(res.status) ? "rejected" : "retry", detail };
	} catch (err) {
		return { result: "retry", detail: String(err) };
	}
}
