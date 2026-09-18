// FR-10 — Verify that the hardcoded author/license (and the fallback version)
// in src/core/citation.ts stay in sync with package.json. Wired into
// .github/workflows/ci.yml; exits 1 on any drift so CI fails loudly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const citationSrc = readFileSync(path.join(ROOT, 'src', 'core', 'citation.ts'), 'utf8');

// Extract the CITATION_META object literal to avoid matching prose in comments.
const metaMatch = /export const CITATION_META = \{([\s\S]*?)\} as const;/.exec(citationSrc);
if (!metaMatch) {
  console.error('check-citation: could not find CITATION_META in src/core/citation.ts');
  process.exit(1);
}
const meta = metaMatch[1];

function field(name) {
  const m = new RegExp(`${name}:\\s*'([^']*)'`).exec(meta);
  if (!m) {
    console.error(`check-citation: CITATION_META.${name} not found in src/core/citation.ts`);
    process.exit(1);
  }
  return m[1];
}

const errors = [];
const citationAuthor = field('author');
const citationLicense = field('license');

if (citationAuthor !== pkg.author) {
  errors.push(`author mismatch: citation.ts="${citationAuthor}" package.json="${pkg.author}"`);
}
if (citationLicense !== pkg.license) {
  errors.push(`license mismatch: citation.ts="${citationLicense}" package.json="${pkg.license}"`);
}

// The runtime fallback version (used when vite `define` is not applied, e.g.
// in vitest) must equal the package version.
const fallbackMatch = /__APP_VERSION__\s*:\s*'([^']+)'/.exec(citationSrc);
if (!fallbackMatch) {
  console.error('check-citation: could not find the __APP_VERSION__ fallback literal in src/core/citation.ts');
  process.exit(1);
}
if (fallbackMatch[1] !== pkg.version) {
  errors.push(`fallback version mismatch: citation.ts="${fallbackMatch[1]}" package.json="${pkg.version}"`);
}

if (errors.length > 0) {
  console.error('check-citation: citation metadata drifted from package.json:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('Fix src/core/citation.ts CITATION_META to match package.json (single source of truth).');
  process.exit(1);
}

console.log(`check-citation: OK (author/license/version in sync with package.json ${pkg.version})`);
