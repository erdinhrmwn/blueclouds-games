import { SQL } from "bun";
import { log } from "../src/log";
import { migrate } from "../src/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
	log.error({ msg: "DATABASE_URL is not set" });
	process.exit(1);
}
const sql = new SQL(url);
try {
	const applied = await migrate(sql);
	log.info({ msg: applied.length ? "migrations applied" : "database is up to date", applied });
} catch (err) {
	log.error({ msg: "migration failed", err: String(err) });
	process.exitCode = 1;
} finally {
	await sql.close();
}
