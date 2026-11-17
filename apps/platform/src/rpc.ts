// The platform's API as a type, for typed clients: `hc<AppType>(url)` from hono/client. Type-only, so
// importing it pulls no platform code into another app's bundle.
export type { AppType } from './app'
