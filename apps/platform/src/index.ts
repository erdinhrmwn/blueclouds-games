import { SQL } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { log } from "./lib/log";
import { createSigner } from "./lib/play-tokens";
import { startJobs } from "./jobs";

const config = loadConfig();
const sql = new SQL(config.db);
const signer = await createSigner(config.playTokenPrivateKey);
const app = createApp({ sql, config, signer });

const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
log.info({ msg: "platform listening", host: config.host, port: server.port });

const jobs = startJobs(sql);

async function shutdown(signal: string) {
	log.info({ msg: "shutting down", signal });
	await server.stop();
	await jobs.stop();
	await sql.close();
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
