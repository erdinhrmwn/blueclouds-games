import { SQL } from 'bun';
import { DATABASE_HOST, DATABASE_NAME, DATABASE_PASSWORD, DATABASE_PORT, DATABASE_USER } from '$app/env/private';

export const sql = new SQL({
	hostname: DATABASE_HOST,
	port: DATABASE_PORT,
	username: DATABASE_USER,
	password: DATABASE_PASSWORD,
	database: DATABASE_NAME
});
