/**
 * FR-20 — Post-build precache manifest generator (pure Node, no deps).
 *
 * Scans the Vite output in `dist/` and injects two placeholders into
 * `dist/sw.js` (copied verbatim from `public/sw.js` by Vite's public-dir
 * step):
 *   const VERSION = '__SW_VERSION__';            → build content hash
 *   const PRECACHE_MANIFEST = /*__PRECACHE_MANIFEST__*\/ []; → ['./index.html', './assets/…']
 *
 * Precache policy (app shell, kept small on purpose):
 *   - index.html, manifest.webmanifest, favicon.svg, ico.ico
 *   - assets/*.js + *.css below MAX_PRECACHE_BYTES each (hashed core chunks;
 *     the multi-MB editor/blockly/duckdb chunks stay in the runtime tier and
 *     are cached on first online use by the SW's stale-while-revalidate rule)
 * Heavy engines (pyodide/, blockly/, webr/, docs/, *.wasm) are NEVER listed
 * here — see public/sw.js header for the network-required matrix.
 *
 * Wired into `vite build` via the ergalics-sw-precache plugin (closeBundle)
 * and callable standalone: `node scripts/gen-sw-precache.mjs [distDir]`.
 * merge-deploy.mjs copies the injected dist/ tree unchanged.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_PRECACHE_BYTES = 512 * 1024;
const SHELL_FILES = ['index.html', 'manifest.webmanifest', 'favicon.svg', 'ico.ico'];

/**
 * Inject the precache manifest + version into `<distDir>/sw.js`.
 * Returns the number of precached entries (0 when skipped).
 */
export function injectSwPrecache(distDirArg) {
  const distDir = resolve(distDirArg ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  const swPath = join(distDir, 'sw.js');
  if (!existsSync(swPath)) {
    console.error(`[gen-sw-precache] missing ${swPath} — run after vite build.`);
    process.exitCode = 1;
    return 0;
  }

  const entries = [];
  for (const f of SHELL_FILES) {
    if (existsSync(join(distDir, f))) entries.push(`./${f}`);
  }
  const assetsDir = join(distDir, 'assets');
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      if (!/\.(js|css)$/.test(name)) continue;
      const full = join(assetsDir, name);
      if (!statSync(full).isFile()) continue;
      if (statSync(full).size > MAX_PRECACHE_BYTES) continue;
      entries.push(`./assets/${name.replaceAll('#', '%23')}`);
    }
  }
  entries.sort();
  const version = `b-${createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12)}`;

  let sw = readFileSync(swPath, 'utf8');
  const versionToken = "const VERSION = '__SW_VERSION__';";
  const manifestToken = 'const PRECACHE_MANIFEST = /*__PRECACHE_MANIFEST__*/ [];';
  if (!sw.includes(versionToken) && !sw.includes(manifestToken)) {
    console.warn('[gen-sw-precache] placeholders not found — sw.js already injected; skipping.');
    return 0;
  }
  sw = sw
    .replace(versionToken, `const VERSION = ${JSON.stringify(version)};`)
    .replace(manifestToken, `const PRECACHE_MANIFEST = ${JSON.stringify(entries)};`);
  writeFileSync(swPath, sw);
  console.log(`[gen-sw-precache] version ${version}: ${entries.length} precached entries → ${swPath}`);
  return entries.length;
}

// CLI entry (tests import the module without triggering this).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  injectSwPrecache(process.argv[2]);
}
