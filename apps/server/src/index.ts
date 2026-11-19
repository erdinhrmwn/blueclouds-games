import { loadPlatformConfig } from './config'
import { registry } from './registry'

loadPlatformConfig() // fail fast on a bad .env, before any room needs it
registry.start()
