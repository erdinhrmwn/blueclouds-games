import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

// Same database and user as the platform: the backoffice reads and changes the platform's tables directly.
export const variables = defineEnvVars({
	DATABASE_HOST: { schema: z.string().min(1) },
	DATABASE_PORT: {
		schema: (value) => {
			const port = Number(value || 5432);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				throw new Error('DATABASE_PORT must be a port number');
			}

			return port;
		}
	},
	DATABASE_USER: { schema: z.string().min(1) },
	DATABASE_PASSWORD: { schema: z.string().default('') },
	DATABASE_NAME: { schema: z.string().min(1) },
	RIVET_TOKEN: {
		description: "The engine's admin token, for reading each game's list of open tables.",
		schema: (value) => {
			if (!value || value.length < 32) {
				throw new Error('RIVET_TOKEN must be at least 32 characters');
			}

			return value;
		}
	},
	RIVET_ENDPOINT: {
		description: 'The engine as this server reaches it.',
		schema: (value) => {
			const url = value || 'http://127.0.0.1:6420';
			if (!URL.canParse(url)) throw new Error('RIVET_ENDPOINT must be a URL');

			return url;
		}
	}
});
