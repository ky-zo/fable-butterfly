import { defineConfig } from 'vite';

// HMR is off by default: several headless screenshot runs share this dev server while worlds are being edited,
// and a hot-reload broadcast mid-capture would ruin them. `HL_HMR=1 npm run dev` turns it back on.
export default defineConfig({
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
    hmr: process.env.HL_HMR === '1',
  },
  // three is native ESM; skipping the dep optimizer means importing a new three/examples module never triggers a re-bundle + reload
  optimizeDeps: { noDiscovery: true, include: [] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
