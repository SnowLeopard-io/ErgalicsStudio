// Build the Ergalics Studio Linux distribution (Electron, AppImage + deb).
//
// Chain: version sync → renderer (vite) → stage dist into deploy/linux/app-dist
// → bundle shared Electron main process (esbuild) → electron-builder --linux.
//
// The Electron main/preload sources are shared with deploy/windows/src; only
// the build output, renderer copy and packaging config live in deploy/linux.
//
// Usage:
//   node scripts/linux-build.mjs              # full build
//   node scripts/linux-build.mjs --from-dist  # reuse an existing dist/
//   node scripts/linux-build.mjs --no-package # stop after bundling the main
//   node scripts/linux-build.mjs --dry-run    # print the plan only
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fromDist = args.has('--from-dist');
const noPackage = args.has('--no-package');

function log(msg) {
  console.log(`[linux-build] ${msg}`);
}

function run(cmd, cwd) {
  log(`${dryRun ? 'DRY RUN' : '$'} ${cmd} (cwd=${path.relative(root, cwd) || '.'})`);
  if (!dryRun) execSync(cmd, { cwd, stdio: 'inherit' });
}

const linuxDir = path.join(root, 'deploy', 'linux');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// 1. Keep the desktop package version in step with the web edition.
const pkgPath = path.join(linuxDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  if (!dryRun) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`linux package version -> ${version}`);
}

// 2. Renderer: the exact same Vite build the web edition ships.
if (!fromDist) {
  run(`${pnpm} run build:web`, root);
}
const distDir = path.join(root, 'apps', 'studio', 'dist');
if (!dryRun && !existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('apps/studio/dist/index.html missing — run the renderer build first');
}

// 3. Stage the renderer where electron-builder expects it.
const appDist = path.join(linuxDir, 'app-dist');
log(`stage ${path.relative(root, distDir)} -> ${path.relative(root, appDist)}`);
if (!dryRun) {
  mkdirSync(appDist, { recursive: true });
  cpSync(distDir, appDist, { recursive: true, force: true });
}

// 4. Bundle the shared Electron main process + preload.
run(`${npm} run build:main --silent`, linuxDir);
if (noPackage) {
  log('stopped after main-process bundle (--no-package)');
  process.exit(0);
}

// 5. Package AppImage + deb. electron-builder must run from deploy/linux/,
//    where its package.json and config live.
run(`${npm} run dist --silent`, linuxDir);

if (!dryRun) {
  const releaseDir = path.join(linuxDir, 'release');
  if (existsSync(releaseDir)) {
    const packages = readdirSync(releaseDir).filter((f) => /\.(AppImage|deb|tar\.gz)$/i.test(f));
    for (const f of packages) log(`artifact -> ${path.join(releaseDir, f)}`);
    if (packages.length === 0) log('warning: no AppImage/deb found in release/');
  }
}
log('done.');
