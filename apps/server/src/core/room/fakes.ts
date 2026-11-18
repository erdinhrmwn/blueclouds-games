// Fakes of the room's ports, for tests: no network, no mock library.

import type { PlatformPort, RoomListPort } from '../domain/ports'

/** A platform that knows no room, sends everything and finds nobody VIP; `overrides` replace any of it. */
export function fakePlatform(overrides: Partial<PlatformPort> = {}): PlatformPort {
  return {
    verifyPlayToken: async () => null,
    reportMatch: async () => ({ result: 'sent' }),
    reportRound: async () => ({ result: 'sent' }),
    fetchRoomSeats: async () => null,
    fetchVipIds: async () => new Set(),
    markRoom: async () => ({ ok: true }),
    ...overrides,
  }
}

/** Room lists that take every report and remember none. */
export function fakeLists(): RoomListPort {
  return {
    report: async () => {},
    remove: async () => {},
  }
}
