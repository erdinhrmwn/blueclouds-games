import type { Admin } from '#lib/server/auth.ts';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in admin; null only on the login page. */
			admin: Admin | null;
		}
	}
}

export {};
