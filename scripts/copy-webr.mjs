// ==========================================================================
// Ergalics Studio — vendor webR locally (optional, FR-04)
//
// The full R runtime (webR) is deliberately NOT an npm dependency: the
// project forbids new deps and runtime CDN access. Production hosts that
// want the full R engine install `webr` separately (or drop its distribution
// into public/webr by hand). This script copies the installed package's
// browser bundle into public/webr so the runtime loads same-origin — the
// exact vendoring pattern used for Pyodide (copy-pyodide.mjs).
//
// When `webr` is not installed this is a NO-OP: the build must never break,
// and the R runtime factory falls back to the built-in IR engine at runtime.
// ==========================================================================

import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'node_modules/webr');
const DEST = resolve(ROOT, 'public/webr');

/** Best-effort: read the installed webr version for the cache marker. */
async function webrVersion() {
  try {
    const pkg = JSON.parse(await readFile(resolve(SRC, 'package.json'), 'utf8'));
    return String(pkg.version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the webR bundle into public/webr when the package is installed.
 * Returns true when assets are in place, false when webR is absent (no-op).
 */
export async function ensureWebRAssets() {
  if (!existsSync(SRC)) {
    // Optional enhancement only — nothing to vendor, build proceeds.
    console.log('[copy-webr] `webr` is not installed — skipping (R runs on the built-in IR engine)');
    return false;
  }
  await mkdir(DEST, { recursive: true });
  const version = await webrVersion();
  const marker = resolve(DEST, '.version');
  if ((await exists(marker)) && (await readFile(marker, 'utf8')).trim() === version) {
    return true; // already vendored at the right version
  }
  console.log(`[copy-webr] copying webR ${version} from node_modules/webr …`);
  // The package ships webr.mjs + the worker/wasm assets under dist/.
  const dist = resolve(SRC, 'dist');
  await cp(existsSync(dist) ? dist : SRC, DEST, { recursive: true });
  await writeFile(marker, `${version}\n`);
  return true;
}

// Run only when executed directly, not when imported by vite.config.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  ensureWebRAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
