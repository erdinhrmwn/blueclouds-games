import { SQL } from 'bun';
import { BACKOFFICE_DB_HOST, BACKOFFICE_DB_NAME, BACKOFFICE_DB_PASSWORD, BACKOFFICE_DB_PORT, BACKOFFICE_DB_USER } from '$app/env/private';

export const sql = new SQL({
	hostname: BACKOFFICE_DB_HOST,
	port: BACKOFFICE_DB_PORT,
	username: BACKOFFICE_DB_USER,
	password: BACKOFFICE_DB_PASSWORD,
	database: BACKOFFICE_DB_NAME
});
