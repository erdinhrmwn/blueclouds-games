import { exportJWK, generateKeyPair } from "jose";

// Prints a fresh Ed25519 key pair for play tokens as raw base64url keys. Private key → platform, public key → actor server.
const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
console.log(`PLAY_TOKEN_PRIVATE_KEY=${(await exportJWK(privateKey)).d}`);
console.log(`PLAY_TOKEN_PUBLIC_KEY=${(await exportJWK(publicKey)).x}`);
