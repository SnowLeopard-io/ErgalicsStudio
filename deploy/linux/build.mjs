// Bundle the Electron main process + preload with esbuild (CJS output).
//
// The main-process sources live in deploy/windows/src and are shared by both
// desktop packagers. Only the build output and packaging config are local to
// this directory; the renderer is staged into app-dist/ by linux-build.mjs.
import { build } from 'esbuild';
import path from 'node:path';

const sharedSrc = path.resolve('..', 'windows', 'src');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', 'simple-git', 'node-pty'],
  sourcemap: false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [path.join(sharedSrc, 'main', 'index.ts')],
  outfile: 'dist-electron/main.js',
});

await build({
  ...common,
  entryPoints: [path.join(sharedSrc, 'preload', 'index.ts')],
  external: ['electron'],
  outfile: 'dist-electron/preload.js',
});
