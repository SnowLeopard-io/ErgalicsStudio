/**
 * Build the native WASM crate (`native/ergalics-core`) and emit
 * bindings into `src/native/` for the Vite frontend to import.
 *
 * Requires: rustup target wasm32-unknown-unknown, wasm-bindgen-cli.
 * If wasm-bindgen-cli is missing it will be installed via cargo.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const nativeDir = join(root, 'native');
const crateDir = join(nativeDir, 'ergalics-core');
const outDir = join(root, 'src', 'native');

const run = (cmd, opts = {}) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
};

function checkWasmBindgen() {
  try {
    execSync('wasm-bindgen --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(crateDir)) {
    console.error('Crate not found:', crateDir);
    process.exit(1);
  }

  run('cargo build --release --target wasm32-unknown-unknown', { cwd: crateDir });

  const wasmFile = join(
    nativeDir,
    'target',
    'wasm32-unknown-unknown',
    'release',
    'ergalics_core.wasm'
  );
  if (!existsSync(wasmFile)) {
    console.error('WASM artifact not found:', wasmFile);
    process.exit(1);
  }

  if (!checkWasmBindgen()) {
    console.log('Installing wasm-bindgen-cli…');
    run('cargo install wasm-bindgen-cli --locked');
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  run(
    `wasm-bindgen --target web --out-dir "${outDir}" --out-name ergalics_core "${wasmFile}"`
  );

  console.log('WASM core built →', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
