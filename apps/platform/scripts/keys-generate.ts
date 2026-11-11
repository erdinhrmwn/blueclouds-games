import { exportJWK, generateKeyPair } from "jose";

// Prints a fresh Ed25519 key pair for play tokens. Private key → platform, public key → actor server.
const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
console.log(`PLAY_TOKEN_PRIVATE_KEY='${JSON.stringify(await exportJWK(privateKey))}'`);
console.log(`PLAY_TOKEN_PUBLIC_KEY='${JSON.stringify(await exportJWK(publicKey))}'`);
