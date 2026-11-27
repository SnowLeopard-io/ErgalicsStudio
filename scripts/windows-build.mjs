// Build the Ergalics Studio Windows distribution.
//
// Chain: wasm stub → renderer (vite) → electron main bundle (esbuild) →
// copy renderer into deploy/windows/app-dist → electron-builder (NSIS).
// website/ and docs/ never enter the package: only app-dist (renderer) and
// dist-electron (main) are packed, resources are copied via extraResources.
//
// Usage:
//   node scripts/windows-build.mjs
//   node scripts/windows-build.mjs --from-dist  # reuse an existing dist/
//   node scripts/windows-build.mjs --no-package # stop after staging app-dist
//   node scripts/windows-build.mjs --dry-run    # print the plan only
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fromDist = args.has('--from-dist');
const noPackage = args.has('--no-package');

function log(message) {
  console.log(`[windows-build] ${message}`);
}

function run(cmd, cwd) {
  console.log(`\n[windows-build] ${cmd} (cwd=${path.relative(root, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

const windowsDir = path.join(root, 'deploy', 'windows');
const appDist = path.join(windowsDir, 'app-dist');
const releaseDir = path.join(windowsDir, 'release');

// CI builds the renderer once and passes --from-dist to each platform script.
// The desktop shortcut copy is a local-development convenience only.
const copyToDesktop = !process.env.CI && !noPackage;

// 0. Keep the desktop package version in step with the web edition: the
//    installer name and stamped exe metadata both come from deploy/windows/package.json.
const appVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

if (dryRun) {
  log(`plan (version ${appVersion}):`);
  log('1. sync deploy/windows/package.json version');
  log(fromDist ? '2. reuse existing apps/studio/dist/ (--from-dist)' : '2. renderer: pnpm run build:web');
  log('3. electron main + preload: npm run build:main (deploy/windows)');
  log(`4. stage renderer: apps/studio/dist/ → ${path.relative(root, appDist)}`);
  log(noPackage ? '5. skip packaging (--no-package)' : '5. package: npm run dist (NSIS)');
  log(`6. copy installers to Desktop: ${copyToDesktop ? 'yes' : 'no'}`);
  process.exit(0);
}

const desktopPkgPath = path.join(windowsDir, 'package.json');
const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, 'utf8'));
if (desktopPkg.version !== appVersion) {
  desktopPkg.version = appVersion;
  writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + '\n');
  log(`desktop version → ${appVersion}`);
}

const studioDist = path.join(root, 'apps', 'studio', 'dist');

// 1. Renderer (same Vite build the web edition ships, wasm stub included).
if (fromDist) {
  if (!existsSync(path.join(studioDist, 'index.html'))) {
    throw new Error('--from-dist requested but apps/studio/dist/index.html is missing');
  }
  log('reusing existing apps/studio/dist/ (--from-dist)');
} else {
  run(`${pnpm} run build:web`, root);
}

// 2. Electron main + preload bundles.
run(`${npm} run build:main --silent`, windowsDir);

// 3. Stage the renderer next to the main bundle for electron-builder.
rmSync(appDist, { recursive: true, force: true });
cpSync(studioDist, appDist, { recursive: true });

if (noPackage) {
  log('stopped after staging app-dist (--no-package)');
  process.exit(0);
}

// 4. Package (NSIS). electron-builder must run from deploy/windows/ where its
//    package.json + config live.
run(`${npm} run dist --silent`, windowsDir);

// 5. Copy the produced installer(s) to the user's desktop (local builds only).
if (copyToDesktop && existsSync(releaseDir)) {
  const outDir = path.join(process.env.USERPROFILE ?? root, 'Desktop');
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(releaseDir)) {
    if (f.endsWith('.exe')) {
      copyFileSync(path.join(releaseDir, f), path.join(outDir, f));
      log(`copied → ${path.join(outDir, f)}`);
    }
  }
}
log('done.');
