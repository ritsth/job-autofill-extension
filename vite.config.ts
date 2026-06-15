import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // CRXJS uses a dev-only websocket; a fixed port keeps HMR stable for
  // extensions. 5173 is Vite's default and is often taken by another project,
  // so this extension uses 5180.
  server: {
    port: 5180,
    strictPort: true,
    hmr: { port: 5180 },
  },
  build: {
    target: 'es2022',
  },
});
