import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { ensurePyodideAssets } from './scripts/copy-pyodide.mjs';
import { ensureBlocklyMedia } from './scripts/vendor-blockly-media.mjs';

// Vendor Pyodide (core + numpy wheel) into public/pyodide so the code-mode
// Python runtime loads same-origin instead of from cdn.jsdelivr.net. Runs in
// both `vite` (dev) and `vite build`.
const vendorPyodide: Plugin = {
  name: 'ergalics-vendor-pyodide',
  async buildStart() {
    await ensurePyodideAssets();
  },
  configureServer() {
    // Belt-and-suspenders for dev requests: make sure assets exist before
    // the first /pyodide/* request lands.
    void ensurePyodideAssets();
  },
};

// Vendor Blockly's media folder (sprite sheet + interaction sounds) into
// public/blockly so block mode never fetches from static.blockly.com,
// which is unreachable from mainland China (TLS cert mismatch). Mirrors the
// Pyodide vendoring plugin below.
const vendorBlocklyMedia: Plugin = {
  name: 'ergalics-vendor-blockly-media',
  async buildStart() {
    await ensureBlocklyMedia();
  },
  configureServer() {
    void ensureBlocklyMedia();
  },
};

export default defineConfig({
  plugins: [react(), vendorPyodide, vendorBlocklyMedia],
  // Build-injected app version (comes from package.json via npm_* env);
  // consumed by the welcome page instead of a hard-coded constant.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Force pre-bundling so these browser-only, dynamically-imported deps are
    // always resolved at startup (otherwise a server started before `npm
    // install` caches the "unresolved" state and never recovers).
    include: ['jspdf', 'svg2pdf.js'],
  },
});
