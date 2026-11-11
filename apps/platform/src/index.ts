import { SQL } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { log } from "./log";

const config = loadConfig();
const sql = new SQL(config.databaseUrl);
const app = createApp({ sql, config });
const server = Bun.serve({ port: config.port, fetch: app.fetch });
log.info({ msg: "platform listening", port: server.port });

async function shutdown(signal: string) {
	log.info({ msg: "shutting down", signal });
	await server.stop();
	await sql.close();
	process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
