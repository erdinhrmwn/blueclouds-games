import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { RIVET_ENDPOINT, RIVET_TOKEN } from '$app/env/private';
import { createClient } from 'rivetkit/client';

/** How long a browser's engine token lasts; the Rivet client asks for a new one when it expires. */
const TOKEN_SECONDS = 15 * 60;

// The engine as this server reaches it, signed in with the admin token.
const url = new URL(RIVET_ENDPOINT ?? PUBLIC_RIVET_ENDPOINT);
url.username = 'default'; // namespace
url.password = RIVET_TOKEN;
const admin = createClient({ endpoint: url.toString(), devtools: false });

/**
 * A namespace token with only what the game page does: create/find room actors and talk to them.
 * Everything else (deleting actors, KV, pools) stays with the admin token.
 */
export async function issueBrowserToken(): Promise<string> {
	const { token } = await admin.auth.issueToken({
		subject: 'browser',
		expiresIn: TOKEN_SECONDS,
		grants: [
			{ resource: 'actor', target: 'any', operations: ['create'] },
			{ resource: 'actor_gateway', target: 'any', operations: ['create', 'read'] }
		]
	});
	return token;
}
