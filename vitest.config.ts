import { defineConfig } from 'vitest/config';

// Standalone Vitest config (deliberately does NOT load the CRXJS/React Vite
// plugins from vite.config.ts — the unit tests exercise pure functions and don't
// need the extension build pipeline or a DOM). Node environment keeps them fast.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
