import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the site works under /<repo>/ on GitHub Pages; the
// workstation lives at ./app/ and is reached through the same prefix.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Fixed port so the workstation dev server always owns 5173 — the
    // studio-link dev bridge (STUDIO_BASE) assumes it regardless of which
    // server starts first.
    port: 5174,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
