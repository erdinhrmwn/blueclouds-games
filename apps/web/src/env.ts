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
	}
});
