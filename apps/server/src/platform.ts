import { importJWK, jwtVerify } from "jose";
import { z } from "zod";

/**
 * Everything the actor server needs from the BlueClouds Platform, in one place, so another
 * platform could replace it later. Reads its config from env on first use.
 */

/** Must match the platform's PLAY_TOKEN_AUDIENCE. */
const PLAY_TOKEN_AUDIENCE = "blueclouds-rooms";

const Env = z.object({
	/** Ed25519 public key (32 bytes, base64url) matching the platform's PLAY_TOKEN_PRIVATE_KEY. */
	PLAY_TOKEN_PUBLIC_KEY: z
		.string()
		.regex(
			/^[A-Za-z0-9_-]{43}$/,
			"must be a 43-character base64url Ed25519 key; run `bun run --filter platform keys:generate`",
		),
	/** Where the actor server reaches the platform API (server to server, not the public URL). */
	PLATFORM_URL: z
		.url()
		.default("http://127.0.0.1:3000")
		.transform((url) => url.replace(/\/+$/, "")),
	/** Bearer key for calls to the platform (match reports, tournament rooms); same value as the platform's. */
	PLATFORM_SERVER_KEY: z.string().min(32, "must be at least 32 characters"),
});
type Env = z.output<typeof Env>;

const PLATFORM_TIMEOUT_MS = 5_000;
const MAX_TOKEN_LENGTH = 2048;
const MAX_DETAIL_LENGTH = 500;
/** Statuses for a body the platform will never accept, so retrying is pointless. */
const REJECTED_STATUSES = [400, 409, 422];

const Claims = z.object({
	sub: z.uuid(),
	name: z.string().trim().min(1).max(20),
	// Tokens signed before the platform added it have no flag.
	vip: z.boolean().default(false),
});
export type Identity = { id: string; name: string; vip: boolean };

let publicKey: Promise<CryptoKey | Uint8Array> | undefined;
let config: Env | undefined;

/** Validates the env once; call at boot so a bad config fails fast. */
export function loadPlatformConfig(env: Record<string, string | undefined> = process.env) {
	const parsed = Env.safeParse(env);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");
		throw new Error(`Invalid actor server config: ${issues}`);
	}

	const jwk = { kty: "OKP", crv: "Ed25519", x: parsed.data.PLAY_TOKEN_PUBLIC_KEY };
	publicKey = importJWK(jwk, "EdDSA");
	config = parsed.data;

	return config;
}

/** Checks a play token from the platform. Returns who it belongs to, or null if it isn't valid. */
export async function verifyPlayToken(token: unknown): Promise<Identity | null> {
	if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
	if (!publicKey) loadPlatformConfig();

	try {
		const { payload } = await jwtVerify(token, await publicKey!, {
			audience: PLAY_TOKEN_AUDIENCE,
			algorithms: ["EdDSA"],
		});

		const claims = Claims.safeParse(payload);
		if (!claims.success) return null;

		return { id: claims.data.sub, name: claims.data.name, vip: claims.data.vip };
	} catch {
		return null;
	}
}

/**
 * Sends a finished match. "sent": stored (or already stored, the platform is idempotent by matchId).
 * "rejected": the platform will never accept this body, so retrying is pointless. "retry": try again later.
 */
export async function reportMatch(report: {
	matchId: string;
}): Promise<{ result: "sent" | "rejected" | "retry"; detail?: string }> {
	try {
		const res = await callPlatform("POST", "/matches", report);
		if (res.ok) return { result: "sent" };

		const detail = await failureDetail(res);
		const result = REJECTED_STATUSES.includes(res.status) ? "rejected" : "retry";

		return { result, detail };
	} catch (err) {
		return { result: "retry", detail: String(err) };
	}
}

const TournamentRoom = z.object({
	visibility: z.enum(["public", "private"]),
	minPlayers: z.number().int().min(1),
	startedAt: z.string().nullable(),
	closedAt: z.string().nullable(),
	tournament: z
		.object({
			name: z.string(),
			startsAt: z.iso.datetime({ offset: true }),
			cancelled: z.boolean(),
		})
		.nullable(),
	seats: z.array(z.object({ playerId: z.uuid(), seat: z.number().int().min(0).nullable() })),
});
export type RoomSeats = z.output<typeof TournamentRoom>;

async function callPlatform(method: string, path: string, body?: unknown): Promise<Response> {
	const { PLATFORM_URL, PLATFORM_SERVER_KEY } = config ?? loadPlatformConfig();

	return fetch(`${PLATFORM_URL}/v1${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${PLATFORM_SERVER_KEY}`,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS),
	});
}

/** Status and the start of the body, for logs. */
async function failureDetail(res: Response): Promise<string> {
	const body = await res.text().catch(() => "");
	return `${res.status} ${body}`.slice(0, MAX_DETAIL_LENGTH);
}

/** The room's tournament, start time and seats. Null if the platform doesn't know the room; throws if it can't be reached. */
export async function fetchRoomSeats(code: string): Promise<RoomSeats | null> {
	const res = await callPlatform("GET", `/rooms/${encodeURIComponent(code)}/seats`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`room seats: ${res.status}`);

	const body = (await res.json()) as { data: { room: unknown } };
	return TournamentRoom.parse(body.data.room);
}

/** Tells the platform a tournament room's match began, or that it gave up. A lost call is fixed by the platform's job and the match report. */
export async function markRoom(
	code: string,
	change: "start" | "close",
): Promise<{ ok: boolean; detail?: string }> {
	try {
		const path = `/rooms/${encodeURIComponent(code)}/${change}`;
		const body = change === "close" ? { reason: "not_enough_players" } : undefined;

		const res = await callPlatform("POST", path, body);
		if (res.ok) return { ok: true };

		return { ok: false, detail: await failureDetail(res) };
	} catch (err) {
		return { ok: false, detail: String(err) };
	}
}
