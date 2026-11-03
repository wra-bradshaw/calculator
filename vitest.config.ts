import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so tests don't load the TanStack Start plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
})
