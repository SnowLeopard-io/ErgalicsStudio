// Run the Electron desktop shell against the running Vite dev server.
//
// The renderer is not bundled here: the desktop main process loads
// ERGALICS_DEV_URL (default http://127.0.0.1:5173/) so HMR applies exactly as
// in the browser. Only the Electron main + preload bundles are rebuilt (with
// esbuild) when they are missing or older than deploy/windows/src.
//
// Usage: npm run dev:desktop            (needs `npm run dev` in another shell)
//        node scripts/desktop-dev.mjs --url http://127.0.0.1:5199/ -- --remote-debugging-port=9222
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const windowsDir = path.join(root, 'deploy', 'windows');
const distElectron = path.join(windowsDir, 'dist-electron');

const argv = process.argv.slice(2);
const urlIndex = argv.indexOf('--url');
const devUrl = urlIndex >= 0 ? argv[urlIndex + 1] : process.env.ERGALICS_DEV_URL ?? 'http://127.0.0.1:5173/';
const sep = argv.indexOf('--');
const passthrough = sep >= 0 ? argv.slice(sep + 1) : argv.filter((_, i) => i !== urlIndex && i !== urlIndex + 1);

/** Newest mtime of any source file under deploy/windows/src. */
function newestSource(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSource(p));
    else newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

function electronBinary() {
  const local = path.join(windowsDir, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  if (existsSync(local)) return local;
  throw new Error(
    `Electron binary missing at ${local}\n` +
      'Install the desktop dependencies first:  npm install --prefix deploy/windows',
  );
}

const mainJs = path.join(distElectron, 'main.js');
const preloadJs = path.join(distElectron, 'preload.js');
const stale = [mainJs, preloadJs].some(
  (f) => !existsSync(f) || statSync(f).mtimeMs < newestSource(path.join(windowsDir, 'src')),
);
if (stale) {
  console.log('[desktop-dev] building Electron main + preload…');
  execFileSync(process.execPath, ['build.mjs'], { cwd: windowsDir, stdio: 'inherit' });
}

// ELECTRON_RUN_AS_NODE turns Electron into a plain Node process (no window);
// some shells/CI images export it, so strip it for this launch.
const env = { ...process.env, ERGALICS_DEV: '1', ERGALICS_DEV_URL: devUrl };
delete env.ELECTRON_RUN_AS_NODE;

console.log(`[desktop-dev] Electron ${env.ERGALICS_DEV_URL}`);
const child = spawn(electronBinary(), ['.', ...passthrough], { cwd: windowsDir, env, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));