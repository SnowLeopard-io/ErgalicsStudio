// ==========================================================================
// Ergalics Studio — vendor Pyodide locally (self-host)
//
// The code-mode Python runtime used to pull Pyodide's ~12MB core (wasm +
// stdlib) and the numpy wheel from cdn.jsdelivr.net at runtime. jsdelivr is
// slow/unreliable in mainland China, so cold starts dragged. This script
// copies the core interpreter out of the already-installed `pyodide` npm
// package into public/pyodide (served same-origin) and downloads the wheels
// for numpy plus the auto-loaded scientific stack (scipy / pandas /
// matplotlib / sympy and their dependencies) once into the same folder, so
// the runtime never touches a CDN.
//
// Runs from a Vite plugin (buildStart + dev server start). Re-runs are cheap:
// the core is skipped when public/pyodide/.version matches, and every wheel is
// skipped when already present — so CI/prod builds only re-fetch missing
// wheels.
// ==========================================================================

import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'node_modules/pyodide');
const DEST = resolve(ROOT, 'public/pyodide');

const PYODIDE_VERSION = JSON.parse(
  await readFile(resolve(SRC, 'package.json'), 'utf8'),
).version;

/** Packages code mode must have, or the build is broken. */
const REQUIRED_PACKAGES = ['numpy'];
/**
 * Scientific stack that is auto-loaded on first `import` (see
 * pyodide-worker.ts). Kept optional: a mirror hiccup degrades to "the first
 * import falls back to a clear ImportError", never to a broken build.
 */
const OPTIONAL_PACKAGES = ['scipy', 'pandas', 'matplotlib', 'sympy'];

// Tried in order; first 200 wins. fastly/gcore mirrors are usually reachable
// from mainland China when the jsdelivr main domain is not.
const MIRROR_HOSTS = ['fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'cdn.jsdelivr.net'];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyCore() {
  await mkdir(DEST, { recursive: true });
  const marker = resolve(DEST, '.version');
  const ready = (await exists(marker)) && (await exists(resolve(DEST, 'pyodide.mjs')));
  if (ready && (await readFile(marker, 'utf8')).trim() === PYODIDE_VERSION) {
    return; // already vendored at the right version
  }
  console.log('[copy-pyodide] copying core interpreter from node_modules/pyodide …');
  await cp(SRC, DEST, { recursive: true });
  await writeFile(marker, `${PYODIDE_VERSION}\n`);
}

async function downloadWheel(fileName, label) {
  const target = resolve(DEST, fileName);
  if (await exists(target)) return true; // already cached locally
  let lastErr;
  for (const host of MIRROR_HOSTS) {
    const url = `https://${host}/pyodide/v${PYODIDE_VERSION}/full/${fileName}`;
    try {
      console.log(`[copy-pyodide] fetching ${label}: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(target, buf);
      console.log(`[copy-pyodide] ${label} saved (${buf.length} bytes)`);
      return true;
    } catch (err) {
      lastErr = err;
      console.warn(`[copy-pyodide] mirror failed: ${url} — ${err.message}`);
    }
  }
  console.warn(`[copy-pyodide] ${label} unavailable from all mirrors: ${lastErr?.message ?? 'unknown'}`);
  return false;
}

/** The pyodide-lock of the installed npm package: names → wheel + deps. */
let lockCache = null;
async function readLock() {
  if (lockCache) return lockCache;
  lockCache = JSON.parse(await readFile(resolve(SRC, 'pyodide-lock.json'), 'utf8'));
  return lockCache;
}

/** Transitive dependency closure of `roots` (includes the roots). */
function dependencyClosure(lock, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkg = lock.packages[name];
    if (!pkg) continue;
    seen.add(name);
    for (const dep of pkg.depends ?? []) queue.push(dep);
  }
  return seen;
}

/**
 * Download every wheel the required/optional package closures need.
 *
 * numpy is required: with a local indexURL, loadPackage(['numpy']) would 404
 * and code mode would fail to become ready, so a failure throws. The scientific
 * stack (pandas / matplotlib / sympy / scipy and their deps) is a convenience:
 * a failed download only warns and leaves the runtime usable.
 */
async function downloadPackages() {
  await mkdir(DEST, { recursive: true });
  const lock = await readLock();

  const required = dependencyClosure(lock, REQUIRED_PACKAGES);
  const optional = [...dependencyClosure(lock, OPTIONAL_PACKAGES)].filter(
    (name) => !required.has(name),
  );

  for (const name of required) {
    const pkg = lock.packages[name];
    if (!pkg?.file_name) {
      throw new Error(`required Pyodide package "${name}" is missing from pyodide-lock.json`);
    }
    const ok = await downloadWheel(pkg.file_name, name);
    if (!ok) {
      throw new Error(`could not download required Pyodide package "${name}" from any mirror`);
    }
  }

  const failed = [];
  for (const name of optional) {
    const pkg = lock.packages[name];
    if (!pkg?.file_name) continue;
    const ok = await downloadWheel(pkg.file_name, name);
    if (!ok) failed.push(name);
  }
  if (failed.length > 0) {
    console.warn(
      `[copy-pyodide] optional packages unavailable (imports will raise until vendored): ${failed.join(', ')}`,
    );
  }
}

export async function ensurePyodideAssets() {
  await copyCore();
  await downloadPackages();
}

// Run only when executed directly (`node scripts/copy-pyodide.mjs`), not when
// imported by vite.config.ts (which drives it via the buildStart plugin hook).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  ensurePyodideAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

