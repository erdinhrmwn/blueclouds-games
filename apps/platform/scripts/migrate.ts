import { SQL } from "bun";
import { loadDbConfig } from "../src/config";
import { log } from "../src/log";
import { migrate } from "../src/migrate";

let sql: SQL;
try {
	sql = new SQL(loadDbConfig());
} catch (err) {
	log.error({ msg: String(err instanceof Error ? err.message : err) });
	process.exit(1);
}
try {
	const applied = await migrate(sql);
	log.info({ msg: applied.length ? "migrations applied" : "database is up to date", applied });
} catch (err) {
	log.error({ msg: "migration failed", err: String(err) });
	process.exitCode = 1;
} finally {
	await sql.close();
}
