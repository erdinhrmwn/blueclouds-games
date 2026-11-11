import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

// Connects as the `backoffice` Postgres role, never as the platform's owner role.
export const variables = defineEnvVars({
	BACKOFFICE_DB_HOST: { schema: z.string().min(1) },
	BACKOFFICE_DB_PORT: {
		schema: (value) => {
			const port = Number(value || 5432);
			if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BACKOFFICE_DB_PORT must be a port number');
			return port;
		}
	},
	BACKOFFICE_DB_USER: { schema: z.string().min(1) },
	BACKOFFICE_DB_PASSWORD: { schema: z.string().default('') },
	BACKOFFICE_DB_NAME: { schema: z.string().min(1) }
});
