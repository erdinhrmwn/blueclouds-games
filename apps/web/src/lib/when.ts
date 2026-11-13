import dayjs from 'dayjs';
import durationPlugin from 'dayjs/plugin/duration';

dayjs.extend(durationPlugin);

/** A date and time in the viewer's own zone and language, e.g. "Fri, 13 Nov, 08:00". */
export const when = (iso: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(iso));

/** "4:07" for a number of whole seconds; the minutes keep counting past an hour ("75:00"). */
export function clock(totalSeconds: number): string {
	const elapsed = dayjs.duration(Math.max(0, totalSeconds), 'seconds');
	const minutes = Math.floor(elapsed.asMinutes());

	return `${minutes}:${elapsed.format('ss')}`;
}
