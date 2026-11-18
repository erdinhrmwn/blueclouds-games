import { loadPlatformConfig } from './core/adapters/platform'
import { registry } from './registry'

loadPlatformConfig() // fail fast on a bad .env, before any room needs it
registry.start()
