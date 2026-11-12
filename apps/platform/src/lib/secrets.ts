/** A player secret: 32 random bytes, base64url (43 chars). */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
/** SHA-256 of a secret: what the database stores, and what the server key check compares. */
export const hashSecret = (secret: string) => new Bun.CryptoHasher("sha256").update(secret).digest();
