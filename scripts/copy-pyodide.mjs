// ==========================================================================
// Ergalics Studio — vendor Pyodide locally (self-host)
//
// The code-mode Python runtime used to pull Pyodide's ~12MB core (wasm +
// stdlib) and the numpy wheel from cdn.jsdelivr.net at runtime. jsdelivr is
// slow/unreliable in mainland China, so cold starts dragged. This script
// copies the core interpreter out of the already-installed `pyodide` npm
// package into public/pyodide (served same-origin) and downloads the numpy
// wheel once into the same folder, so the runtime never touches a CDN.
//
// Runs from a Vite plugin (buildStart + dev server start). Re-runs are cheap:
// the core is skipped when public/pyodide/.version matches, and the wheel is
// skipped when already present — so CI/prod builds only re-fetch numpy when
// the cached copy is missing.
// ==========================================================================

import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'node_modules/pyodide');
const DEST = resolve(ROOT, 'public/pyodide');

const PYODIDE_VERSION = '314.0.3';
const NUMPY_WHL = 'numpy-2.4.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl';

// Tried in order; first 200 wins. fastly/gcore mirrors are usually reachable
// from mainland China when the jsdelivr main domain is not.
const NUMPY_MIRRORS = [
  `https://fastly.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/${NUMPY_WHL}`,
  `https://gcore.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/${NUMPY_WHL}`,
  `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/${NUMPY_WHL}`,
];

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

async function downloadNumpy() {
  const target = resolve(DEST, NUMPY_WHL);
  if (await exists(target)) return; // already cached locally
  let lastErr;
  for (const url of NUMPY_MIRRORS) {
    try {
      console.log(`[copy-pyodide] fetching numpy wheel: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(target, buf);
      console.log(`[copy-pyodide] numpy wheel saved (${buf.length} bytes)`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[copy-pyodide] mirror failed: ${url} — ${err.message}`);
    }
  }
  // numpy is required: with a local indexURL, loadPackage(['numpy']) would 404
  // and code mode would fail to become ready. Fail loudly instead of shipping
  // a silently broken build.
  throw new Error(`could not download numpy wheel from any mirror: ${lastErr?.message ?? 'unknown'}`);
}

export async function ensurePyodideAssets() {
  await copyCore();
  await downloadNumpy();
}

// Run only when executed directly (`node scripts/copy-pyodide.mjs`), not when
// imported by vite.config.ts (which drives it via the buildStart plugin hook).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  ensurePyodideAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

