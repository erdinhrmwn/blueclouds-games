import { setup } from "rivetkit";
import { bust31Room } from "./games/bust-31/actor";

// One actor type per game; each actor instance is one room (keyed by room code).
// Services (agentOS, durable streams) are unused here; skipping them avoids
// an extra local process and its port clashing with other Rivet projects.
export const registry = setup({ use: { bust31Room }, startServices: false });
