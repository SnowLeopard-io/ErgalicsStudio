import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensurePyodideAssets } from '../../scripts/copy-pyodide.mjs';
import { ensureBlocklyMedia } from '../../scripts/vendor-blockly-media.mjs';
import { ensureWebRAssets } from '../../scripts/copy-webr.mjs';
import { injectSwPrecache } from '../../scripts/gen-sw-precache.mjs';
import { ensureWasmStub } from '../../scripts/make-wasm-stub.mjs';
import cspPolicy from '../../scripts/csp-policy.json';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(appRoot, '..', '..');

/**
 * Vendoring is an optimisation, never a startup dependency. A fresh checkout
 * has no public/pyodide or public/blockly (both generated/gitignored), and a
 * blocked mirror must not take down `pnpm dev` — Vite must always come up
 * so the rest of the workbench (block mode, data IO, plots) remains usable.
 */
async function safeVendor(name: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.warn(`[${name}] non-fatal vendoring failure: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// package.json is the single source of truth for the app version.
const pkgVersion = (
  JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

const vendorPyodide: Plugin = {
  name: 'ergalics-vendor-pyodide',
  async buildStart() {
    await safeVendor('copy-pyodide', ensurePyodideAssets);
  },
  configureServer() {
    void safeVendor('copy-pyodide', ensurePyodideAssets);
  },
};

const vendorBlocklyMedia: Plugin = {
  name: 'ergalics-vendor-blockly-media',
  async buildStart() {
    await safeVendor('vendor-blockly-media', ensureBlocklyMedia);
  },
  configureServer() {
    void safeVendor('vendor-blockly-media', ensureBlocklyMedia);
  },
};

const vendorWebR: Plugin = {
  name: 'ergalics-vendor-webr',
  async buildStart() {
    await safeVendor('copy-webr', ensureWebRAssets);
  },
  configureServer() {
    void safeVendor('copy-webr', ensureWebRAssets);
  },
};

const wasmStub: Plugin = {
  name: 'ergalics-wasm-stub',
  buildStart() {
    ensureWasmStub();
  },
  configureServer() {
    ensureWasmStub();
  },
};

const swPrecache: Plugin = {
  name: 'ergalics-sw-precache',
  apply: 'build',
  closeBundle() {
    injectSwPrecache(resolve(appRoot, 'dist'));
  },
};

export default defineConfig({
  plugins: [react(), wasmStub, vendorPyodide, vendorBlocklyMedia, vendorWebR, swPrecache],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? pkgVersion),
    __ZENODO_DOI__: JSON.stringify(process.env.ZENODO_DOI ?? ''),
    __WEBR_AVAILABLE__: JSON.stringify(
      existsSync(resolve(appRoot, 'node_modules/webr')) ||
        existsSync(resolve(repoRoot, 'node_modules/webr')) ||
        existsSync(resolve(appRoot, 'public/webr/webr.js')),
    ),
  },
  base: './',
  server: {
    // Fixed port so the website's studio-links and the docs' cross-site
    // switcher (both hard-code 5173 in dev) always reach this workspace,
    // regardless of which dev server starts first.
    port: 5173,
    strictPort: true,
    fs: {
      // Allow Vite dev server to serve workspace packages and shared examples/
      allow: [repoRoot],
    },
    headers: { 'Content-Security-Policy-Report-Only': cspPolicy.reportOnly },
  },
  preview: {
    headers: { 'Content-Security-Policy-Report-Only': cspPolicy.reportOnly },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1500,
    modulePreload: {
      polyfill: true,
      resolveDependencies: () => [],
    },
    rollupOptions: {
      output: {
        manualChunks: (id: string): string | undefined => {
          if (id.includes('vite/preload-helper')) return 'preload-helper';
          const pkg = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1];
          if (!pkg) return undefined;
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
    include: ['jspdf', 'svg2pdf.js'],
    exclude: ['simple-git'],
  },
});
