// RivetKit's local dev engine is spawned from native code, which sees only the real
// process env, not values Bun loaded from .env. Pass the admin token through so dev
// checks tokens like production.
const server = Bun.spawn(["bun", "--watch", "src/index.ts"], {
	env: { ...process.env, RIVET__AUTH__ADMIN_TOKEN: process.env.RIVET_TOKEN },
	stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await server.exited);
