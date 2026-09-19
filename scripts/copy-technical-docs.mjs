// Mirror docs/technical into website/public/technical at build time.
//
// The technical documents (8 chapters + full summary + bilingual READMEs,
// each as .md/.html/.pdf) are the single source of truth under docs/. The
// official website serves them as static downloads, so this script copies
// them into website/public/ — Vite then emits them next to the site. The
// HTML exports reference ./assets/, so the folder is mirrored too.
//
// Run automatically via the predev/prebuild hooks in website/package.json.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs', 'technical');
const dest = join(root, 'website', 'public', 'technical');

if (!existsSync(src)) {
  console.error(`[copy-technical-docs] source not found: ${src}`);
  process.exit(1);
}

const COPIED_EXTS = new Set(['.md', '.html', '.pdf']);

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let count = 0;
for (const name of readdirSync(src)) {
  // Measurement probes from scripts/build-tech-docs.mjs (interrupted runs).
  if (name.startsWith('.measure-')) continue;
  const file = join(src, name);
  if (!statSync(file).isFile()) continue;
  if (!COPIED_EXTS.has(name.slice(name.lastIndexOf('.')).toLowerCase())) continue;
  cpSync(file, join(dest, name));
  count++;
}

if (existsSync(join(src, 'assets'))) {
  cpSync(join(src, 'assets'), join(dest, 'assets'), { recursive: true });
}

console.log(`[copy-technical-docs] copied ${count} documents -> website/public/technical`);
