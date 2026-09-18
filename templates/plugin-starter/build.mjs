// ==========================================================================
// Post-build step: assemble the .cspkg package directory.
//
//   tsc (tsconfig.build.json)  ->  dist/index.js        (plain script)
//   node build.mjs             ->  package/manifest.json
//                                  package/dist/index.js (entry = body + return)
//
// The host evaluates the entry as `new Function('api', source)`, so the
// emitted script body must end with `return plugin;` — appended here (a
// top-level return is invalid TypeScript in script mode, hence the split).
// No dependencies: plain Node (>= 18).
// ==========================================================================

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'package');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

const body = readFileSync(join(root, 'dist', 'index.js'), 'utf8');
writeFileSync(join(out, 'dist', 'index.js'), body + '\nreturn plugin;\n');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
// `signature` is written by the signing tool into package/manifest.json.
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log('package/ ready — sign it with scripts/sign-cspkg.mjs (see README).');
