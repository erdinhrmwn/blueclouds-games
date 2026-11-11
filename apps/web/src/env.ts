import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_RIVET_ENDPOINT: {
		public: true,
		description: 'URL the browser uses to reach the Rivet engine.',
		schema: (value) => {
			const url = value || 'http://127.0.0.1:6420';
			if (!URL.canParse(url)) throw new Error('PUBLIC_RIVET_ENDPOINT must be a URL');
			return url;
		}
	},
	RIVET_TOKEN: {
		description: "The engine's admin token. Server side only: it issues short-lived tokens for browsers.",
		schema: (value) => {
			if (!value || value.length < 32) throw new Error('RIVET_TOKEN must be at least 32 characters');
			return value;
		}
	},
	RIVET_ENDPOINT: {
		description: 'The engine as this server reaches it (internal network). Defaults to PUBLIC_RIVET_ENDPOINT.',
		schema: (value) => {
			if (value && !URL.canParse(value)) throw new Error('RIVET_ENDPOINT must be a URL');
			return value || undefined;
		}
	},
	PLATFORM_URL: {
		description: 'Platform API as this server reaches it (internal network). Browsers never call it.',
		schema: (value) => {
			const url = value || 'http://127.0.0.1:3000';
			if (!URL.canParse(url)) throw new Error('PLATFORM_URL must be a URL');
			return url.replace(/\/+$/, '');
		}
	}
});
