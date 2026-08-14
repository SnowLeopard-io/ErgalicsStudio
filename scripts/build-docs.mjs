/**
 * Build the standalone VitePress docs site (docs/) and copy the output
 * into dist/docs/ so the welcome page's "Docs" link works from a preview.
 *
 * Run: node scripts/build-docs.mjs
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docsDir = join(root, 'docs');
const built = join(docsDir, '.vitepress', 'dist');
const target = join(root, 'dist', 'docs');

if (!existsSync(join(docsDir, 'package.json'))) {
  console.error('Docs workspace not found:', docsDir);
  process.exit(1);
}

console.log('> Building docs (vitepress)…');
execSync('npm run build', {
  cwd: docsDir,
  stdio: 'inherit',
  // Absolute base so in-app links resolve correctly. Overridable so the
  // public path matches where the docs are actually served:
  //   - domain-root embed / local preview  -> "/docs/"
  //   - GitHub Pages embed (this repo)      -> "/ErgalicsStudio/docs/"
  //     (set by .github/workflows/deploy.yml)
  env: { ...process.env, DOCS_BASE: process.env.DOCS_BASE ?? '/docs/' },
});

if (!existsSync(built)) {
  console.error('Docs build output not found:', built);
  process.exit(1);
}

// Replace any previous copy (e.g. the public/docs placeholder) with the
// freshly built site. Ignore deletion failures from sandboxed tooling.
try {
  rmSync(target, { recursive: true, force: true });
} catch {
  /* ignore — files will be overwritten below */
}
mkdirSync(target, { recursive: true });
cpSync(built, target, { recursive: true });

console.log('Docs site →', target);
