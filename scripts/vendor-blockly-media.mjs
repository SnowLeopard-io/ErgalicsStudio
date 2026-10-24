// ==========================================================================
// Ergalics Studio — vendor Blockly media locally (self-host)
//
// When `Blockly.inject` runs without an explicit `media` option, Blockly
// falls back to `https://static.blockly.com/media/` for sprites.svg and the
// interaction sounds (click / disconnect / delete / drop .mp3). That domain
// is unreachable from mainland China (TLS cert mismatch), which spammed the
// console with net::ERR_CERT_COMMON_NAME_INVALID and unhandled rejections on
// every block-mode mount, and left block rendering without its sprite sheet.
//
// This script copies the media folder out of the already-installed `blockly`
// npm package into public/blockly (served same-origin) so the editor
// never touches static.blockly.com. Runs from a Vite plugin (buildStart +
// dev server start). Re-runs are cheap: skipped when the copied files'
// blockly version marker matches the installed package.
// ==========================================================================

import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'node_modules/blockly/media');
const DEST = resolve(ROOT, 'public/blockly');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function installedBlocklyVersion() {
  const pkg = resolve(ROOT, 'node_modules/blockly/package.json');
  try {
    return JSON.parse(await readFile(pkg, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function ensureBlocklyMedia() {
  if (!(await exists(SRC))) {
    // blockly not installed yet (fresh clone before `npm install`) — skip
    // quietly; the next dev/build run after install will vendor it.
    return;
  }
  const version = await installedBlocklyVersion();
  await mkdir(DEST, { recursive: true });
  const marker = resolve(DEST, '.version');
  const ready = (await exists(marker)) && (await exists(resolve(DEST, 'sprites.svg')));
  if (ready && (await readFile(marker, 'utf8')).trim() === version) {
    return; // already vendored at the right version
  }
  console.log('[vendor-blockly-media] copying media from node_modules/blockly/media …');
  await cp(SRC, DEST, { recursive: true });
  await writeFile(marker, `${version}\n`);
}

// Run only when executed directly (`node scripts/vendor-blockly-media.mjs`),
// not when imported by vite.config.ts (which drives it via buildStart).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  ensureBlocklyMedia().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
