// Build the Ergalics Studio Windows distribution.
//
// Chain: wasm stub → renderer (vite) → electron main bundle (esbuild) →
// copy renderer into deploy/windows/app-dist → electron-builder (NSIS).
// website/ and docs/ never enter the package: only app-dist (renderer) and
// dist-electron (main) are packed, resources are copied via extraResources.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, cwd) {
  console.log(`\n[windows-build] ${cmd} (cwd=${path.relative(root, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

const windowsDir = path.join(root, 'deploy', 'windows');

// 0. Keep the desktop package version in step with the web edition: the
//    installer name and stamped exe metadata both come from deploy/windows/package.json.
const appVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const desktopPkgPath = path.join(windowsDir, 'package.json');
const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, 'utf8'));
if (desktopPkg.version !== appVersion) {
  desktopPkg.version = appVersion;
  writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + '\n');
  console.log(`[windows-build] desktop version → ${appVersion}`);
}

// 1. Renderer (same Vite build the web edition ships, wasm stub included).
run(`${npm} run build:web --silent`, root);

// 2. Electron main + preload bundles.
run(`${npm} run build:main --silent`, windowsDir);

// 3. Stage the renderer next to the main bundle for electron-builder.
const appDist = path.join(windowsDir, 'app-dist');
rmSync(appDist, { recursive: true, force: true });
cpSync(path.join(root, 'dist'), appDist, { recursive: true });

// 4. Package (NSIS). electron-builder must run from deploy/windows/ where its
//    package.json + config live.
run(`${npm} run dist --silent`, windowsDir);

// 5. Copy the produced installer(s) to the user's desktop.
const releaseDir = path.join(windowsDir, 'release');
const outDir = path.join(process.env.USERPROFILE ?? root, 'Desktop');
if (existsSync(releaseDir)) {
  mkdirSync(outDir, { recursive: true });
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(releaseDir)) {
    if (f.endsWith('.exe')) {
      copyFileSync(path.join(releaseDir, f), path.join(outDir, f));
      console.log(`[windows-build] copied → ${path.join(outDir, f)}`);
    }
  }
}
console.log('\n[windows-build] done.');
