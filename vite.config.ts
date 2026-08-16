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
    // Vite emits <link rel="modulepreload" crossorigin> into the extension's
    // HTML entry points. Chrome refuses to reuse those preloads inside an
    // extension page — "a preload ... is not used because it is a cross-world
    // extension resource mismatch" — so every chunk is fetched twice-over and
    // each one logs an error on chrome://extensions.
    //
    // The hints buy nothing here: extension pages load their chunks off local
    // disk, not the network. Turning them off removes the warnings without
    // changing what actually gets loaded.
    modulePreload: false,
  },
});
