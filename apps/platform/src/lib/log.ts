type Fields = Record<string, unknown>;

/** One JSON line per event, so logs can be grepped and shipped as-is. */
function write(level: "info" | "warn" | "error", fields: Fields): void {
	const line = JSON.stringify({ level, time: new Date().toISOString(), ...fields });
	if (level === "error") {
		console.error(line);
	} else {
		console.log(line);
	}
}

export const log = {
	info: (fields: Fields) => write("info", fields),
	warn: (fields: Fields) => write("warn", fields),
	error: (fields: Fields) => write("error", fields),
};
