# Getting Started

## Prerequisites

- **Node.js ≥ 20** and npm
- **Rust toolchain** with the `wasm32-unknown-unknown` target and
  `wasm-bindgen-cli` — required only to build the native core. The frontend
  degrades gracefully (with retries) when the WASM module is absent, so a
  quick frontend-only setup is possible.

## Install & run

```bash
npm install
npm run dev
```

The welcome page runs hardware self-checks (WebGPU, WASM, IndexedDB) and
shows the results before you enter the workbench.

## Build

```bash
npm run build          # wasm → typecheck → vite build
npm run build:web      # frontend only
npm run build:wasm     # rebuild the Rust core into src/native
```

`npm run build` always rebuilds the WASM core first so the bindings shipped
to `dist/` are fresh. Build artifacts under `src/native/` (`.js`, `.wasm`)
are git-ignored; only the generated `.d.ts` files are tracked.

## Tests

```bash
npm test          # unit tests (Vitest)
npm run test:e2e  # Playwright suites against a production preview
npm run verify    # typecheck + unit tests
```

## Documentation site

The docs are a separate VitePress workspace:

```bash
cd docs
npm install
npm run dev       # local docs site
npm run build     # static site → docs/.vitepress/dist
```

The main build copies the docs output into `dist/docs/`, so the welcome
page's **Docs** link works from a preview server. The site can also be
deployed independently (e.g. GitHub Pages).

## Reproducing the sample data

Example datasets are generated deterministically (seeded LCG), so
regenerating them is safe:

```bash
node scripts/make-example-data.mjs
```

This rewrites `examples/data/*` and the base64 image asset in
`src/core/exampleAssets.ts`.
