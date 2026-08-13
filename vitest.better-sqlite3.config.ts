import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from './vitest.config.ts'

export default mergeConfig(baseConfig, defineConfig({
  test: {
    name: 'better-sqlite3',
    env: {
      SQLITE_IMPL: 'better-sqlite3'
    }
  }
}))
