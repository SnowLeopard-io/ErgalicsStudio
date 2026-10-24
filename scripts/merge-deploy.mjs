/**
 * Merge the website and workstation build outputs into one GitHub Pages
 * artifact:
 *
 *   pages-out/            website (root of /<repo>/)
 *   pages-out/app/        workstation (incl. its embedded docs/ copy)
 *
 * Run after: npm run build:website && npm run build:web
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const websiteDist = join(root, 'website', 'dist');
const appDist = join(root, 'dist');
const out = join(root, 'pages-out');

for (const [label, dir] of [['website', websiteDist], ['workstation', appDist]]) {
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(`Missing ${label} build output (${dir}/index.html). Build it first.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(websiteDist, out, { recursive: true });
mkdirSync(join(out, 'app'), { recursive: true });
cpSync(appDist, join(out, 'app'), { recursive: true });

console.log('Pages artifact →', out);
