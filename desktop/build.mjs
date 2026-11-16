// Bundle the Electron main process + preload with esbuild (CJS output).
import { build } from 'esbuild';

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
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist-electron/main.js',
});

await build({
  ...common,
  entryPoints: ['src/preload/index.ts'],
  external: ['electron'],
  outfile: 'dist-electron/preload.js',
});
