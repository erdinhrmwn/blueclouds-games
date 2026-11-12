import { SQL } from 'bun';
import { createAdmin } from '../src/lib/server/auth.ts';

// Usage: bun run admin:create <username>
// The password is typed on the terminal (hidden), never passed as an argument, so it stays out of shell history.

/** Reads one line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
	if (!process.stdin.isTTY)
		return Promise.reject(
			new Error('Run this in an interactive terminal (docker compose exec -it ...).')
		);
	process.stdout.write(question);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	return new Promise((resolve, reject) => {
		let value = '';
		const done = (err?: Error) => {
			process.stdin.off('data', onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdout.write('\n');
			if (err) reject(err);
			else resolve(value);
		};
		const onData = (chunk: Buffer) => {
			for (const ch of chunk.toString('utf8')) {
				if (ch === '\r' || ch === '\n') return done();
				if (ch === '\u0003') return done(new Error('Cancelled.')); // Ctrl+C
				if (ch === '\u007f')
					value = value.slice(0, -1); // backspace
				else value += ch;
			}
		};
		process.stdin.on('data', onData);
	});
}

const username = process.argv[2];
if (!username) {
	console.error('Usage: bun run admin:create <username>');
	process.exit(1);
}

const env = process.env;
const sql = new SQL({
	hostname: env.DATABASE_HOST,
	port: Number(env.DATABASE_PORT || 5432),
	username: env.DATABASE_USER,
	password: env.DATABASE_PASSWORD ?? '',
	database: env.DATABASE_NAME
});

try {
	const password = await askHidden('Password: ');
	if ((await askHidden('Repeat password: ')) !== password)
		throw new Error('The passwords do not match.');
	await createAdmin(sql, username, password);
	console.log(`Admin "${username}" created.`);
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await sql.close();
}
