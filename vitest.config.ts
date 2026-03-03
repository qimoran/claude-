import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['electron/**/*.test.ts', 'node'],
    ],
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'release'],
  },
})
