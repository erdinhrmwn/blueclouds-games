import { importJWK, SignJWT } from "jose";
import type { Player } from "./auth";

/** Room actors only accept tokens with this audience. */
export const PLAY_TOKEN_AUDIENCE = "blueclouds-rooms";
export const PLAY_TOKEN_TTL_SECONDS = 15 * 60;

export type PlayToken = { token: string; expiresAt: string };
export type Signer = { sign: (player: Player) => Promise<PlayToken> };

/** Builds the play-token signer from an Ed25519 private JWK; fails at startup if the key is wrong. */
export async function createSigner(privateJwk: string): Promise<Signer> {
	let jwk: Record<string, unknown>;
	try {
		jwk = JSON.parse(privateJwk);
	} catch {
		throw new Error("PLAY_TOKEN_PRIVATE_KEY must be a JSON JWK");
	}
	if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string") {
		throw new Error("PLAY_TOKEN_PRIVATE_KEY must be an Ed25519 private JWK");
	}
	const key = await importJWK(jwk, "EdDSA");
	return {
		async sign(player) {
			const iat = Math.floor(Date.now() / 1000);
			const exp = iat + PLAY_TOKEN_TTL_SECONDS;
			const token = await new SignJWT({ name: player.name })
				.setProtectedHeader({ alg: "EdDSA" })
				.setSubject(player.id)
				.setAudience(PLAY_TOKEN_AUDIENCE)
				.setIssuedAt(iat)
				.setExpirationTime(exp)
				.sign(key);
			return { token, expiresAt: new Date(exp * 1000).toISOString() };
		},
	};
}
