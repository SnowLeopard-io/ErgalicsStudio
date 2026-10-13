# Roadmap & Status

The project is under **active development** — every item marked **Done** here is
in the codebase and covered by the test suites. This table reflects the actual
state, not aspirational designs.

## Module status

| Module        | Features                                                       | Status       |
| ------------- | -------------------------------------------------------------- | ------------ |
| Welcome page  | hardware self-checks, language/theme switcher, enter workbench | Done      |
| Workbench     | top bar + activity bar + multi-view sidebar (Files / Git / Plugins), tabbed central area (plugin canvas / file previews / editors / embedded tools), file explorer + file info panel, drag & drop, status bar | Done      |
| File editors  | per-file editors: `.py`/`.js`/`.r` → Monaco, `*.flow.json` → Flow DAG, `*.block.json` → Blockly; open-in-mode bridge, dirty state, save back to workspace | Done      |
| Workspace VFS | `src/core/vfs/` — LightningFS (browser) / memory (Node/tests) file system shared by the explorer, editors and Git working tree | Done      |
| Git-backed projects | `src/core/git/` adapter (isomorphic-git browser / simple-git Node), sidebar Git panel (branch / commit / clone / pull-push-fetch, CORS proxy), auto-commit, preinstalled hooks + CI template | Done |
| Plugin system | load/activate/unload, registry, built-ins, cspkg + sandbox     | Done      |
| Projects      | create/save/open/autosave/share `.clproj`                      | Done      |
| Data loading  | file picker / drag & drop / format detection / routing         | Done      |
| Rendering     | 2D canvas + host Three.js scene (lazy, visibility-managed)     | Done      |
| Flow mode     | compiler (validate/topology) + executor (incremental cache) + 38 built-in block types + Flow canvas + result preview + sample pipelines | Done      |
| Block mode    | shared IR + Blockly 13 (lazy-loaded) + interpreter + JS / Python codegen + 40 built-in blocks + 5 sample programs + `studio.*` API reusing Flow ops + i18n via `BKY_*` | Done      |
| i18n          | zh-CN / en-US, detection, reactive switching, Blockly `BKY_*`  | Done      |
| Theming       | dark/light, system-follow, CSS variables                       | Done      |
| Settings      | general / GPU / data / about                                   | Done      |
| Perf monitor  | FPS / frame / GPU / memory / data-scale + warnings             | Done      |
| Sharing       | link generation, project export                                | Done      |
| Native core   | device mgmt, `GpuBuffer`, compute kernel (compile/bind-group/dispatch/run/diagnostics) | Core done |
| GPU compute   | `api.gpu` compute surface, WGSL templates, particles / 3-D N-body / LBM fluid / wave equation / histogram / heatmap / point-cloud kernels accelerated (CPU fallback), real-device E2E verification | Done      |
| Statistics    | descriptive stats, special functions, t-tests / ANOVA / Mann–Whitney / chi-square, effect sizes, Bonferroni & BH corrections, power analysis; surfaced as 14 Flow-mode `stats.*` blocks | Done      |
| Experiment tracking | per-project run records (IndexedDB `runs` store), run-history dialog with A/B parameter diff (`src/stores/experimentStore.ts`, `src/core/experiment/record.ts`) | Done      |
| Uncertainty suite | bootstrap CI, Monte-Carlo sampling, MCMC (normal likelihood, uninformative prior) with cancellation — `src/core/uncertainty/` + `/studio/uncertainty` page (CPU or WGSL GPU engine) | Done      |
| Unit system | typed `Quantity` with SI parsing, dimensional algebra + `units.convert`/`units.check` blocks + QuantityInput (`src/core/units/`) | Done      |
| Data lineage  | file→run DAG rebuilt from run records + ingestion, layered layout (`src/core/lineage/`), LineageCanvas dialog | Done      |
| Chunked ingestion | async row-window reader for large delimited files, preview + fingerprint (`src/core/chunked/`) | Done      |
| Research toolset | 26 standalone tools under `/studio/<id>`, grouped in six categories (measurement & uncertainty, model & inference, data & graphs, signal & records, deliver & reproduce, utilities; the analysis page is excluded from the welcome grid), also embeddable as workbench tabs (`src/pages/research/toolRegistry.ts`) | Done      |
| Figure Studio | multi-panel publication figures on journal templates (IEEE/Elsevier), SVG/PDF/PNG-600dpi export, `/studio/figures` route (`src/core/figure/`) | Done      |
| Supplement packaging | paper-ready zip with manifest.json (runs + lineage + contents: data/code/files + optional repro.lock) (`src/core/package/supplement.ts`) | Done      |
| Notebook      | mixed markdown/code cells in the project, dedicated Pyodide runtime, runs feed the experiment history — `/studio/notebook` route (`src/core/notebook/`) | Done      |
| Scientific I/O| HDF5 / NetCDF / FITS / Zarr / Parquet import via a single dispatcher (`src/core/io/`) | Done      |
| Plot engine   | pure-TS SVG renderer with scales/ticks, SVG + PDF export (`src/core/plot/`) | Done      |
| Reproducibility| seeded RNG, run manifests, DAG-to-Python export (`src/core/repro/`) | Done      |
| Physics labs  | electromagnetism, optics (ray tracing with dispersion), structural mechanics (truss with collapse) — interactive, data-driven | Done      |
| Code mode     | Monaco + Pyodide (Python) + REPL + 9 sample programs on the existing IR; three-mode conversion (Block ↔ Flow ↔ Code via IR) done; **R ships as a full webR runtime** (vendored in `public/webr/`, auto-copied by `scripts/copy-webr.mjs`, missing bundle falls back to the IR engine) | Done |
| Scientific solvers | sparse Hermitian eigensolver (thick-restart Lanczos / LOBPCG / Jacobi-Davidson + MINRES shift-invert, 2-D spectrum report + 3-D mode fields) and 1D–3D fluid-network bidirectional coupler (multi-rate time-step coordination + coarse–fine subcycling), both run in Pyodide workers — `em-eigensolver`, `fluid-cfd-coupler` | Done |
| Marketplace   | plugin registry UI & remote install; `.cspkg` package-signing gate (ed25519, FR-05) live | Signing gate: Done · registry/install: Next |
| CI            | GitHub Actions (unit + E2E + Pages deploy)                     | Done      |
| Error handling| error boundaries, fallbacks, retry                            | Partial   |

## Milestones

| Milestone | Status | Delivered / remaining |
| --- | --- | --- |
| **M1 — Solidify the foundations** | complete | Plugin lifecycle, sandbox and signing gate, test suites and the docs site are all landed. |
| **M2 — Real GPU compute** | complete | The native core exposes `GpuBuffer` + `ComputeKernel::run`, the plugin API ships an `api.gpu` compute surface, and reusable WGSL templates live in `src/core/wgsl.ts`. GPU acceleration now spans Particles (single-buffer integration), N-Body Gravity (3-D all-pairs with ping-pong buffers), the D2Q9 LBM fluid (collide + stream), the wave-equation leapfrog, the histogram / heatmap / point-cloud kernels, the matmul / FFT / k-means / binning compute kernels, and the sparse matrix–vector multiply (SpMV) kernel — each with a matching CPU fallback. `npm run test:e2e` drives the real WebGPU path in headless Edge (SwiftShader): a numeric harness compares the GPU result against the CPU integrator (passing within ~2e-6), and an app integration step clicks through the Particles plugin and asserts a `wasm`-engine GPU toast. Remaining follow-up: GPU perf telemetry per kernel. |
| **M3 — Code mode** | complete | Python (Pyodide) is complete — Monaco editor, CPython Worker runtime with importable `studio` module, REPL + variable snapshots, worker interrupt, and 9 sample programs under `examples/code/`. R is complete too — a full webR runtime is vendored in `public/webr/` (auto-copied by `scripts/copy-webr.mjs` and verified by `verify-r-runtime.mjs`), falling back to the IR engine when the bundle is absent. The three-mode conversion (Block ↔ Flow ↔ Code round-trip through the shared IR) is done and pinned by a `sync-threeway` unit test. |
| **M4 — Marketplace** | signing gate Done · registry/install Next | Package registry, versioning, and in-app install/update flows. The `.cspkg` package-signing gate (ed25519, FR-05) already shipped with the security work — see `SECURITY.md`. |
| **M5 — CI + release** | all complete | GitHub Actions pipeline, artifact publishing, and the docs site deployed to Pages (see `.github/workflows/`). |

## Known limitations (honest)

| Limitation | Details |
| --- | --- |
| Sandbox isolation scope | The plugin sandbox isolates the page context (globals, DOM, stores) but workers share the origin's IndexedDB — a malicious package could still read app data. The `.cspkg` package-signing gate (ed25519, FR-05) is live (see `SECURITY.md`); the missing piece is a self-service third-party submit & install pipeline. |
| `new Function` fallback | The legacy fallback (when Workers are unavailable) is not a security boundary; the UI warns when it is used. |
| WebGPU availability | The WebGPU compute path requires a WebGPU-capable browser; without one the app runs in CPU-fallback mode. |
| `studio.load` resolution | Block / Code mode resolves `studio.load(...)` via the project files registry (`setProjectFiles` + `resolveDataFile`) so project-owned files, bundled examples, and Code-mode `_FILES` share a single loader. |
| GPU block execution | Block mode and the IR are designed so a `gpu.*` family of nodes slots in later; the worker-side runner and the `ComputeKernel` dispatch from a block are not yet wired. |
