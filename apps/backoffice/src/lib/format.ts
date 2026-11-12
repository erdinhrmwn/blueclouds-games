/** Dates in the backoffice are shown in UTC, the same as the database and the logs. */
export const utc = (d: Date | string | null) =>
	d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
