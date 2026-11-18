import { setup } from 'rivetkit'
import { log } from './core/adapters/log'
import { bust31Room } from './games/bust-31/room'
import { cloudburstRoom } from './games/cloudburst/room'
import { roomList } from './room-list'

// Per game: a room actor (one instance per room code). One room list per game (key = slug).
// Services (agentOS, durable streams) are unused here; skipping them avoids
// an extra local process and its port clashing with other Rivet projects.
export const registry = setup({
  use: { bust31Room, cloudburstRoom, roomList },
  startServices: false,
  endpoint: process.env.RIVET_ENDPOINT,
  token: process.env.RIVET_TOKEN,
  logging: { baseLogger: log },
})
