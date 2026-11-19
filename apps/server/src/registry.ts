import { setup } from 'rivetkit'
import { loadRivetConfig } from './config'
import { log } from './core/adapters/log'
import { bust31Room } from './games/bust-31/room'
import { cloudburstRoom } from './games/cloudburst/room'
import { roomList } from './room-list'

// Per game: a room actor (one instance per room code). One room list per game (key = slug).
// Services (agentOS, durable streams) are unused here; skipping them avoids
// an extra local process and its port clashing with other Rivet projects.
const rivet = loadRivetConfig()

export const registry = setup({
  use: { bust31Room, cloudburstRoom, roomList },
  startServices: false,
  endpoint: rivet.endpoint,
  token: rivet.adminToken,
  logging: { baseLogger: log },
})
