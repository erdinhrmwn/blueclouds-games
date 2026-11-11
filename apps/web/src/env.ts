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
	PUBLIC_PLATFORM_URL: {
		public: true,
		description: 'URL the browser uses to reach the BlueClouds Platform API.',
		schema: (value) => {
			const url = value || 'http://127.0.0.1:3000';
			if (!URL.canParse(url)) throw new Error('PUBLIC_PLATFORM_URL must be a URL');
			return url.replace(/\/+$/, '');
		}
	}
});
