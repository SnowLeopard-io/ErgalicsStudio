import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensurePyodideAssets } from './scripts/copy-pyodide.mjs';
import { ensureBlocklyMedia } from './scripts/vendor-blockly-media.mjs';
import { ensureWebRAssets } from './scripts/copy-webr.mjs';
import { injectSwPrecache } from './scripts/gen-sw-precache.mjs';

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

// Vendor the webR bundle (full R runtime, FR-04) into public/webr so the R
// code mode loads it same-origin instead of from a CDN. OPTIONAL by design:
// webR is not an npm dependency, so this is a no-op unless a `webr` package
// happens to be installed — the build never breaks and the R runtime falls
// back to the built-in IR engine. Mirrors the Pyodide vendoring plugin.
const vendorWebR: Plugin = {
  name: 'ergalics-vendor-webr',
  async buildStart() {
    await ensureWebRAssets();
  },
  configureServer() {
    void ensureWebRAssets();
  },
};

// FR-20: after the bundle is written, inject the precache manifest + version
// hash into dist/sw.js (public/sw.js ships with the placeholder tokens).
// Runs only for builds; merge-deploy.mjs copies the injected file unchanged.
const swPrecache: Plugin = {
  name: 'ergalics-sw-precache',
  apply: 'build',
  closeBundle() {
    injectSwPrecache();
  },
};

export default defineConfig({
  plugins: [react(), vendorPyodide, vendorBlocklyMedia, vendorWebR, swPrecache],
  // Build-injected app version (comes from package.json via npm_* env);
  // consumed by the welcome page instead of a hard-coded constant.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    // FR-10: Zenodo DOI minted by the release workflow's archive job. Empty
    // string until a tagged release is archived; the citation card then shows
    // a "pending release archive" placeholder instead of a fake DOI.
    __ZENODO_DOI__: JSON.stringify(process.env.ZENODO_DOI ?? ''),
    // FR-04: webR is optional and not vendored by default. Knowing this at
    // build time lets the R runtime skip the dynamic import entirely instead
    // of probing /webr/webr.js and logging a 404 on every R session. True
    // when the package is installed (the vendor plugin copies it at startup)
    // or the bundle is already vendored into public/webr. (The browser entry
    // is webr.js — dist/webr.mjs is a Node-only build.)
    __WEBR_AVAILABLE__: JSON.stringify(
      existsSync(resolve(fileURLToPath(new URL('.', import.meta.url)), 'node_modules/webr')) ||
        existsSync(resolve(fileURLToPath(new URL('.', import.meta.url)), 'public/webr/webr.js')),
    ),
  },
  base: './',
  server: {
    // Fixed port so the website's studio-links and the docs' cross-site
    // switcher (both hard-code 5173 in dev) always reach this workspace,
    // regardless of which dev server starts first.
    port: 5173,
    strictPort: true,
  },
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
        // B2: every large dependency gets a named chunk, via *function* form.
        // (Object form once dragged Vite's preload helper into the
        // 'export-pdf' chunk; the entry statically imports that helper for
        // every dynamic import site, so the whole 154 kB jspdf/svg2pdf chunk
        // became modulepreload-eager — caught by build-budget on 2026-09-21.)
        // All deps listed here are reached exclusively through dynamic
        // imports (three via scene3d, blockly/monaco via the lazy editors,
        // the rest via the IO/runtime loaders); naming them keeps each one in
        // its own cacheable file. The preload helper gets its own tiny chunk
        // (see below) so the entry's static edge to it stays cheap.
        manualChunks: (id: string): string | undefined => {
          // Vite's preload helper is statically imported by the entry AND by
          // every chunk holding a dynamic import; Rollup's greedy heuristic
          // can drop it into a large manual chunk (it once landed in
          // 'export-pdf', dragging 154 kB of jspdf into the first screen).
          // Give it its own tiny chunk so that static edge stays cheap.
          if (id.includes('vite/preload-helper')) return 'preload-helper';
          const pkg = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1];
          if (!pkg) return undefined;
          // Scoped packages: compare on the scope so @tensorflow/tfjs-*,
          // @zarrita/*, @duckdb/* all collapse into their parent chunk.
          const base = pkg.startsWith('@') ? pkg.split('/')[0]! : pkg;
          if (base === 'react' || base === 'react-dom' || base === 'scheduler' || base === 'react-router' || base === 'react-router-dom' || base === '@remix-run') return 'react';
          if (base === 'three') return 'three';
          if (base === 'blockly') return 'blockly';
          if (base === 'monaco-editor') return 'monaco';
          if (base === '@duckdb') return 'duckdb';
          if (base === '@tensorflow') return 'tfjs';
          if (base === 'apache-arrow' || base === 'parquet-wasm' || base === 'h5wasm' || base === 'netcdfjs' || base === 'zarrita' || base === '@zarrita') return 'data-io';
          if (base === 'jspdf' || base === 'svg2pdf.js') return 'export-pdf';
          return undefined;
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
