import { setup } from "rivetkit";
import { bust31Room } from "./games/bust-31/actor";
import { roomList } from "./games/shared/directory";

// Per game: a room actor (one instance per room code). One room list per game (key = slug).
// Services (agentOS, durable streams) are unused here; skipping them avoids
// an extra local process and its port clashing with other Rivet projects.
export const registry = setup({
	use: { bust31Room, roomList },
	startServices: false,
	endpoint: process.env.RIVET_ENDPOINT,
	token: process.env.RIVET_TOKEN,
});
