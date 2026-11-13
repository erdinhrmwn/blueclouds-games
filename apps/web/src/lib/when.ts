/** A date and time in the viewer's own zone and language, e.g. "Fri, 13 Nov, 08:00". */
export const when = (iso: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(iso));
