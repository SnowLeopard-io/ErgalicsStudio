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

## Editing Plugin Data Online

When working with charts, statistics, or scientific plugins, **you do not need external software (such as Excel) to author or tweak CSV/JSON datasets**:

1. **Inspect data requirements**: Activating any data-driven plugin displays its **Data Contract Card** at the top of the right panel (required/optional columns, types, physical units, and value constraints).
2. **Edit online with live sync**: Click **✎ Edit Data** to open a resizable bottom drawer below the canvas (**Live Sync** is on by default — valid edits refresh the plot and science readout strip after 300ms; click **⤢ Expand** anytime for a full modal view). Tabular schemas provide a spreadsheet grid with Excel/CSV `Ctrl+V` block paste, undo/redo, and real-time cell validation; JSON schemas open Monaco with JSON Schema autocomplete and diagnostics.
3. **Templates & smart column mapping**: Click **✦ Template** to populate sample data immediately. Uploading a CSV whose headers differ from the plugin's column names opens an interactive **Column Mapping** dialog instead of failing with an exception.
4. **Sync with global project data**: Save your edited dataset directly to **Project Data** (overwrite or save-as) so other compatible plugins, Code/Flow modes, and research suites can reuse it. The top-bar **Data** modal automatically shows compatibility badges (`✓ Compatible` / `⇄ Map Cols` / `✕ Mismatch`) and an inline **✎** edit button.

## Build

```bash
npm run build          # wasm → typecheck → vite build → copy docs
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
