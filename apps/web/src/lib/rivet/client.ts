import { PUBLIC_RIVET_ENDPOINT } from '$app/env/public';
import { createClient } from 'rivetkit/client';
import type { registry } from 'server';

// devtools off: the local engine does not serve the devtools bundle, which only adds a 404.
export const client = createClient<typeof registry>({ endpoint: PUBLIC_RIVET_ENDPOINT, devtools: false });
