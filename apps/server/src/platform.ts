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
});

const Claims = z.object({ sub: z.uuid(), name: z.string().trim().min(1).max(20) });
export type Identity = { id: string; name: string };

let publicKey: Promise<CryptoKey | Uint8Array> | undefined;

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
	return parsed.data;
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
