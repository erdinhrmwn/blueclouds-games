import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";

/** Room actors only accept tokens with this audience. */
export const PLAY_TOKEN_AUDIENCE = "blueclouds-rooms";
export const PLAY_TOKEN_TTL_SECONDS = 15 * 60;

export type PlayToken = { token: string; expiresAt: string };
export type Signer = { sign: (player: { id: string; name: string }) => Promise<PlayToken> };

/** PKCS#8 DER header for a raw 32-byte Ed25519 seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Builds the play-token signer from the base64url Ed25519 seed (config checks its format). */
export async function createSigner(privateKey: string): Promise<Signer> {
	const der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(privateKey, "base64url")]);
	const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });

	return {
		async sign(player) {
			const issuedAt = Math.floor(Date.now() / 1000);
			const expiresAt = issuedAt + PLAY_TOKEN_TTL_SECONDS;

			const token = await new SignJWT({ name: player.name })
				.setProtectedHeader({ alg: "EdDSA" })
				.setSubject(player.id)
				.setAudience(PLAY_TOKEN_AUDIENCE)
				.setIssuedAt(issuedAt)
				.setExpirationTime(expiresAt)
				.sign(key);

			return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
		},
	};
}
