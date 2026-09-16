<div align="center">

<img src="ico.ico" alt="Ergalics Studio logo" width="96" />

<h1>Ergalics Studio</h1>

<p><b>An in-browser scientific computing workstation</b> — interactive data
exploration, GPU compute scheduling, and a sandboxed plugin system, all
running in the browser with a Rust/WASM core.</p>

<p>
<a href="https://snowleopard-io.github.io/ErgalicsStudio/"><img alt="Try the live demo" src="https://img.shields.io/badge/Try%20the%20live%20demo-0891b2?style=for-the-badge" /></a>
</p>

<p>
<a href="https://github.com/SnowLeopard-io/ErgalicsStudio"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-SnowLeopard--io%2FErgalicsStudio-181717?logo=github&logoColor=white&style=flat-square" /></a>
<a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" /></a>
<a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript&logoColor=white&style=flat-square" /></a>
<a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white&style=flat-square" /></a>
<a href="#gpu-compute"><img alt="WebGPU" src="https://img.shields.io/badge/WebGPU-WGSL-8b5cf6?style=flat-square" /></a>
<a href="#native-core"><img alt="WASM" src="https://img.shields.io/badge/WASM-Rust-000000?logo=rust&logoColor=white&style=flat-square" /></a>
</p>

</div>

<br>

![Ergalics Studio — Standard mode (drag → see)](docs/studio.png)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Layout](#project-layout)
- [Standard Mode](#standard-mode)
- [Flow Mode](#flow-mode)
- [Block Mode](#block-mode)
- [Code Mode](#code-mode)
- [Research Modules](#research-modules-科研)
- [Plugin System](#plugin-system)
- [GPU Compute & Native Core](#gpu-compute--native-core)
- [Testing](#testing)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Ergalics Studio is a professional scientific-computing workstation that runs
entirely in the browser. It combines a React + TypeScript frontend, a Rust
core compiled to WebAssembly, a WebGPU compute pipeline, and a plugin
architecture designed for third-party extensions.

The workbench exposes four modes for four kinds of users — see the section
for each one below:

- **Standard** — drag a dataset onto a plugin, see the visualisation. The
  fastest path from "I have data" to "I see something".
- **Flow** — compose a visual dataflow pipeline from built-in blocks, run it
  topologically, inspect every node's output.
- **Block** — a Scratch-like block editor where a single "Run" hat block
  kicks off the program. Beginner-friendly, but fully scripted (variables,
  loops, conditionals, transforms, plots).
- **Code** — a Monaco Python editor backed by a Pyodide worker runtime, with
  the same `studio.*` API as block mode, a REPL console and a variable panel.

Ergalics Studio is under **active development** and already usable end to
end: the core loop (project management, data loading, plugin registry, 2D/3D
rendering, i18n, theming, performance monitoring, the Flow mode, the Block
mode, and the Code mode with a Pyodide Python runtime) is functional and
covered by tests. GPU acceleration spans Particles, N-Body, the LBM fluid,
the wave equation, histogram, heatmap and point-cloud kernels. On top of the
first research toolset (experiment tracking, uncertainty quantification, a
unit system, data lineage, chunked ingestion, a figure studio, supplement
packaging and a notebook), a second-generation research platform has
landed: a GPU uncertainty engine, Sweep Studio, Signal Lab, Model Lab, Data
Profiler, Repro Lock, a DuckDB-powered SQL Workbench, a Report Builder and
a headless Bayesian inference engine (HMC/NUTS) — every research tool is a
standalone full-page lab sharing one unified shell. Package signing for the
plugin marketplace, the inference UI and the R runtime (webR) are the next
milestones. Every module is kept deliberately small and testable so the
codebase keeps scaling without a rewrite.

> Status: **Active development** — usable today with four workbench modes,
> 40 built-in plugins (30 core + 10 fun), a sandboxed plugin system, a
> marketplace catalog, live GPU compute, an in-browser AI training plugin,
> a statistics subsystem, scientific binary I/O (HDF5 / NetCDF / FITS /
> Zarr / Parquet), a publication-grade SVG/PDF plot engine, reproducibility
> support, a Pyodide-powered Python code editor, and a 14-page research
> workbench (Analysis, Experiment Runs, Uncertainty, Model Lab, Data
> Profiler, Signal Lab, Sweep Studio, SQL Workbench, Report Builder, Repro
> Lock, Data Lineage, Figure Studio, Notebook, Supplement packaging) plus
> supporting kernels (unit system, chunked ingestion); package signing, the
> inference UI and the R runtime are next.

---

## Features

**Workbench**

- Four-region layout: sidebar (projects / plugins), central viewport, right
  parameter panel, status bar with GPU/perf indicators. The top bar groups
  its actions into five semantic clusters separated by dividers —
  `[标准 | 流程 | 积木 | 代码]` mode switch, `[数据⓷ | 示例]` data cluster,
  `[项目▾ | 保存 | 分享]` project cluster (项目▾ = new / open / save-as /
  export log), `[分析 | 科研▾]` research cluster, and `[⚙ | ? | FPS | 语言 |
  主题]` environment cluster.
- Welcome-page quick start: six mode cards (Experiment Runs, Uncertainty,
  Model Lab, Sweep Studio, Signal Lab, Report Builder) jump straight into
  the corresponding standalone page; the same cards render in the workbench
  empty state. A guided tour (`?` in the top bar) walks new users through
  the workbench.
- Project lifecycle: create / open / save / autosave / share (`.clproj`
  format stored in IndexedDB).
- File routing: drag & drop any file; the host detects the format by magic
  number **and** extension (with optional WASM assist) and routes it to a
  matching plugin — with a picker dialog when multiple plugins match.
  Import dialogs filter by file format so unrecognized files never reach a
  parser.

**Rendering**

- 2D canvas container shared by all 2D plugins (point clouds, particles,
  time series, histograms, heatmaps, image viewer, contour plots, scatter,
  bar charts, radar, network graphs, bubble charts, violin plots, sankey
  diagrams, box plots, parallel coordinates, error bands, treemaps, QQ
  plots, and the fractal/art toys).
- Host-managed **Three.js 3D scene** (`Scene3DHandle`): grid/axes/lights,
  orbit controls, resize handling, auto camera fit, and GPU-safe disposal.
  The 3D surface is created lazily — only for plugins that declare 3D
  capability (`renderToScene`) — and is **automatically hidden when a 2D
  plugin is active**, so a 3D coordinate system never bleeds into a 2D view.

**Plugin system**

- **40 built-in plugins** — 30 core/scientific plugins plus 10 fun &
  utility toys — covering the full API surface (2D canvas, Three.js scene,
  WGSL compute, buttons/toggles, sandboxing, in-browser model training).
- **Two-tier loading**: core plugins are auto-loaded at startup; fun/utility
  plugins declare `autoload: false` and are loaded on demand from the
  built-in panel or the marketplace tab, keeping the startup registry lean.
- **Marketplace catalog** (`src/plugins/marketplace.ts`) — every built-in
  plugin is surfaced with curated tags, popularity, and category filters
  (scientific / fun / utility); community "coming soon" submissions are
  listed as placeholders.
- `.cspkg` package loading (ZIP with `manifest.json` + entry + assets) with
  manifest validation (id format, entry path traversal guard, sandbox enum).
- **Real sandbox isolation** (§6.2): third-party entry code runs inside a
  Web Worker with a postMessage RPC bridge — no access to the host page's
  globals, DOM, or stores. Canvas rendering works via a transferred
  `OffscreenCanvas`; a documented best-effort fallback exists when Workers
  are unavailable.
- Locale-aware parameter panels (range / select / number / checkbox / text /
  file / button / toggle).

**Infrastructure**

- i18n (zh-CN / en-US) with reactive locale switching.
- Dark/light theming via CSS variables.
- Performance monitor: FPS, frame time, GPU time, memory, data scale, with
  warning thresholds (§7.3).
- Error boundaries, fallbacks, and a banner/notification system.

**Scientific computing subsystems (pure TypeScript, unit-tested)**

- **Statistics kernel** (`src/core/stats/`) — descriptive statistics,
  special functions (incomplete gamma/beta, inverse CDFs), hypothesis
  tests (one/two-sample & paired t-tests, one-way ANOVA, Mann–Whitney U,
  chi-square independence), effect sizes (Cohen's d, Pearson/Spearman
  correlation), multiple-comparison corrections (Bonferroni,
  Benjamini–Hochberg) and two-sample power analysis.
- **Scientific binary I/O** (`src/core/io/`) — a single dispatcher routes
  dropped files to loaders for HDF5 (h5wasm), NetCDF (netcdfjs), FITS
  (fitsjs), Parquet (parquet-wasm) and Zarr (zarrita), turning each
  variable/dataset/HDU into project data files.
- **Publication-grade plot engine** (`src/core/plot/`) — a pure-TS
  SVG renderer with linear/log/temporal scales and nice ticks, plus
  SVG and PDF export for line, scatter, histogram and bar charts.
- **Reproducibility kernel** (`src/core/repro/`) — seeded RNG
  (mulberry32), stable hashing, run manifests (seed + version + input
  hashes + graph hash) and DAG-to-Python export for reruns.
- **Run-log export** (`src/core/logger.ts` + `download.ts`) — session
  logs can be exported from the workbench for bug reports.

**Research toolset (科研 — pure-TS cores + Zustand stores + standalone pages)**

Every research tool is now a **standalone full page** (not a dialog) sharing
one lab shell — a back-to-workbench header plus an unconstrained scrollable
body. The cores under `src/core/` stay pure TypeScript, unit-tested, and
wired into the event bus, so run history, the lineage DAG and the
supplement manifest pick them up automatically.

- **Experiment tracking** (`src/core/experiment/` + `experimentStore`,
  `/#/runs`) — every Flow / Block / Code / Notebook / Sweep / Uncertainty /
  Model-Lab run is recorded into a per-project IndexedDB `runs` store with
  source, parameters, metrics and duration; the Runs page lists the history
  and diffs any two runs' parameters side by side.
- **GPU uncertainty engine** (`src/core/uncertainty/`, `/#/uncertainty`) —
  bootstrap confidence intervals, Monte-Carlo error propagation and
  Metropolis–Hastings MCMC with an engine picker (auto / CPU / GPU). The
  GPU path (WGSL PCG32 RNG, one workgroup per chain) accelerates
  million-sample resampling; Gelman–Rubin R-hat and ESS diagnostics flag
  convergence. Runs against any project data file; every result records
  the engine and device used.
- **Model Lab** (`src/core/model/`, `/#/model-lab`) — OLS (QR), logistic
  (IRLS), ridge (K-fold CV) and polynomial regression with coefficient
  tables (estimate / SE / p / CI) and a 2×2 residual diagnostic panel;
  every fit is recorded into the run history.
- **Data Profiler** (`src/core/profiler/`, `/#/profiler`) — a single
  streaming pass produces per-column profiles (types, missing rates,
  cardinality, five-number summaries, histograms, outliers), a correlation
  matrix and a 0–100 quality score with an issue list; cached by content
  fingerprint for instant re-opens.
- **Signal Lab** (`src/core/signal/`, `/#/signal`) — FFT / power spectral
  density (Welch), window functions, Savitzky–Golay and moving-average
  filters, ACF/PACF and seasonal decomposition; filtered columns can be
  saved back as derived data files that automatically join the lineage DAG.
- **Sweep Studio** (`src/core/sweep/`, `/#/sweeps`) — define 1–3 parameter
  axes (grid / list / Latin hypercube) and batch-run any pipeline source;
  results render as error-bar lines, response-surface heatmaps or parallel
  coordinates, and every sub-run lands in the experiment history.
- **SQL Workbench** (`src/core/sql/`, `/#/sql`) — a lazy-loaded
  DuckDB-WASM engine registers project data files as tables; query them
  with join / aggregation / window functions in a Monaco editor, preview
  results, and save them as new CSVs that inherit lineage edges.
- **Report Builder** (`src/core/report/`, `/#/report`) — compose ordered
  sections (headings, markdown, figures, tables, run summaries,
  interactive filters) and export a single self-contained HTML file with
  inline SVG, vanilla-JS interactivity, light/dark themes and zh/en
  languages.
- **Repro Lock** (`src/core/repro/lock.ts`, `/#/reprolock`) — export a
  `repro.lock` (data fingerprints + parameter hashes + seeds + code
  snapshots + versions), verify it against a moved or aged project with a
  five-class drift report, and re-run the locked runs to confirm metrics
  reproduce.
- **Unit system** (`src/core/units/`) — typed `Quantity` values with SI
  prefix parsing, dimensional algebra and conversion checks; surfaced as
  `units.convert` / `units.check` Flow blocks and a `QuantityInput`
  parameter widget.
- **Data lineage** (`src/core/lineage/` + `lineageStore`, `/#/lineage`) — a
  file→run DAG rebuilt automatically from run records and ingestion events,
  laid out in layers and rendered as an SVG canvas; SQL queries, derived
  Signal-Lab columns and sweeps all appear as nodes.
- **Chunked ingestion** (`src/core/chunked/` + `chunkStore`) — an async
  row-window reader for large delimited files (CSV / TSV / DAT / XYZ / TXT)
  with column projection, preview sampling and content fingerprinting.
- **Figure Studio** (`src/core/figure/`, `/#/figures`) — compose
  multi-panel publication figures on journal templates (IEEE / Elsevier,
  single & double column) with auto panel tags (a, b, c…), captions, a live
  SVG preview and SVG / PDF / PNG-600dpi export.
- **Supplement packaging** (`src/core/package/`, `/#/supplement`) — one
  click builds a paper-ready ZIP: `manifest.json` (project metadata + run
  records + lineage graph + author/license/description form) plus optional
  data files and code sessions.
- **Notebook** (`src/core/notebook/`, `/#/notebook`) — mixed
  markdown/code cells persisted in the project; code cells run on a
  dedicated Pyodide runtime (terminated on unmount) and every notebook run
  feeds the experiment history.
- **Inference engine (headless)** (`src/core/inference/`) — HMC and NUTS
  samplers with R-hat / bulk-ESS / tail-ESS diagnostics, HDI, MCSE, WAIC /
  PSIS-LOO model comparison and posterior predictive checks. The numeric
  core has landed; UI wiring is the next step.
- **Analysis page** (`/#/analysis`) — the quick path: pick a data file and
  get line / scatter / histogram / bar charts, descriptive statistics and
  one-sample / two-sample / Mann–Whitney tests with SVG / PDF export.

**Flow mode (visual dataflow pipeline)**

- A second workbench mode next to Standard — toggle with the `Standard | Flow`
  switch in the top bar. Standard mode is *load data → see it*; Flow mode is
  *compose a visual pipeline → run it → see every node's output*.
- 37 built-in blocks organised by category: data sources, transforms,
  filters, math, statistics (including t-tests, ANOVA, Mann–Whitney,
  chi-square, correlation, effect sizes and multiple-comparison
  corrections), plotting and visualizations. Control-flow blocks
  (if/else, repeat, parallel) are deliberately deferred — the `region`
  seam on `BlockInstance` is in place so they slot in later as an
  extension, not a refactor.
- **Compiler is a pure function**: structural validation (ports / required
  inputs / type compatibility), cycle detection, and Kahn-style topological
  sort. Errors come back as structured `diagnostics` so the canvas can paint
  red edges and an inline diagnostic strip without ever throwing.
- **Executor with incremental caching** at per-node granularity plus a
  dirty-propagation invalidation pass — change a single block's parameter and
  only it and its downstream re-execute.
- **Result preview** with one click: `RenderedView` outputs go through the
  existing plugin renderer (scatter, histogram, …); `DataTable` outputs
  render as a read-only table (so `stats.summary` / `stats.histogram` bins
  actually show something); `Scalar` outputs render inline. A chip switcher
  picks which node to inspect when a pipeline has more than one output.
- **Reactive parameter editor** bound to the selected node, with a two-way
  link to the canvas — the node card shows the live `key: value` summary, so
  you always see what the canvas is actually running.
- **Block metadata is localized** (`nameI18n` / `descriptionI18n`) and the
  palette, node card, and parameter panel all resolve via
  `src/blocks/l10n.ts`, so adding a locale is a data-only change.
- **Sample pipelines live as `.clproj` files** under `examples/projects/`
  (`block-01-signal-analysis.clproj`, …). They are normal projects — loadable
  through the standard project picker — and discovered at build time via
  `import.meta.glob`. Adding a new sample is dropping a file plus an entry in
  `SAMPLE_META`.
- The whole graph persists into the project's `blockGraph` and rehydrates on
  open, sharing the autosave/share/export pipeline that already backs every
  `.clproj`.

**Block mode (Scratch-style scripted editor)**

- A third workbench mode — `Standard | Flow | Blocks | Code` in the top
  bar. The Block mode is the entry point for learners and for anyone who
  wants an imperative feel: you write a top-down script of blocks under a
  single green **「运行时 / Run」hat**, and that hat is the only execution
  entry point (orphan blocks never run).
- 30+ built-in blocks organised by category — Start, Data, Variables,
  Operators, Transform, Statistics, Visualize, Control, Utility — covering
  data sources (`load CSV`, `load XYZ`, `random`, `range`), transforms
  (`normalize`, `sort`, `select`, `filter`), statistics (`summary`,
  `histogram`), plots (`scatter`, `line`, `histogram`, `point cloud`),
  control flow (`if`, `repeat`, `while`, `for_each`), and 1-to-1 utility
  primitives (`set`, `print`).
- **Shared IR** (`src/editor/ir/`) is the single source of truth. Block
  JSON ↔ IR round-trips in a pure, Node-testable module — the same IR that
  Code mode shares with Block mode for bidirectional sync.
- **IR interpreter** (`src/editor/runtime/interpreter.ts`) walks the IR
  directly and calls into the **same `studio.*` API** that Flow-mode blocks
  use (`studio.load / normalize / plot / print / …`), so `studio.plot(
  'scatter', df, { x, y })` lands in the very same scatter plugin a Flow-
  mode `viz.scatter` block does.
- **IR → JS / Python codegen** (`src/editor/codegen/`) emits runnable code
  from the IR; the toolbar's "Python" / "JS" toggle shows the live codegen
  result for the current workspace.
- **Blockly 13** powers the canvas (`src/editor/block/`); the package is
  **lazy-loaded** so Standard / Flow first paint is unaffected (~828 KB
  on-demand chunk).
- **Block names, tooltips, dropdown options, and toolbox categories are
  localised** through Blockly's `BKY_*` key system; switching language
  re-creates the workspace with re-labelled blocks and is verified by a
  dedicated unit test (`tests/editor/block-i18n.test.ts`).
- **Sample programs** live in `src/editor/block/samples.ts` (5 built-in
  pipelines: galaxy scatter, telemetry line, random histogram, normalised
  scatter, repeat-print) and are loaded via the **Examples** dialog in the
  top bar — discoverable by any user, one click away.

**Code mode (Monaco + Pyodide Python runtime)**

- A fourth workbench mode — `Standard | Flow | Blocks | Code` in the top
  bar. Code mode is the escape hatch for real scripting: write free-form
  **Python** in a Monaco editor and run it on **CPython via a Pyodide Web
  Worker**.
- **Same `studio.*` API** as block mode (`load / random / range / normalize /
  sort / select / addColumn / filter / summary / histogram / plot / print /
  notify / getParam / setParam`), injected as a real importable Python
  module; `studio.plot(...)` renders through the shared plugin bridge.
- **REPL** input in the console panel evaluates single expressions without
  a full re-run; **stop** terminates and respawns the worker so runaway
  loops cannot hang the page.
- **9 sample programs** live as real files under `examples/code/*.py`
  (loaded via `import.meta.glob`, display metadata in
  `src/editor/code/samples.ts`) and load through the **Examples** dialog —
  from a one-liner scatter to an EDA pipeline, Monte-Carlo π, and signal
  smoothing.

---

## Architecture

```mermaid
flowchart TB
    subgraph UI["React UI (src/pages · src/components/blocks)"]
        A1["Welcome · Workbench<br/>(TopBar/Sidebar/Central/Right/Status)"]
        A2["Settings · Share ·<br/>Plugin dialogs · Example-data dialogs"]
        A3["Flow mode canvas<br/>Palette · Canvas · Node · Param editor<br/>Toolbar · Result preview"]
    end

    subgraph State["State & Core Services"]
        B1["Zustand stores<br/>app / project / plugin / settings / block"]
        B2["Core services<br/>storage (IndexedDB) · events (bus)<br/>i18n · theming · perf<br/>fileFormat · wasm · gpu<br/>scene3d · sandbox"]
    end

    subgraph Blocks["Block system (Flow mode, src/blocks)"]
        D1["Catalog<br/>data_source · transform · filter<br/>math · statistics · visualize · logic"]
        D2["Compiler<br/>pure · validates ports/types<br/>topological sort · diagnostics"]
        D3["Executor<br/>incremental cache<br/>dirty propagation · run()"]
        D4["Render bridge<br/>viz.* RenderedView → plugin.loadData<br/>(side-effect-free executor)"]
    end

    subgraph Runtime["Runtime Layer"]
        C1["Plugin runtime<br/>builtin/* (30 core + 10 fun)<br/>marketplace catalog<br/>cspkg loader (sandbox)<br/>registry & lifecycle"]
        C2["Native core (Rust→WASM)<br/>device mgmt · compute<br/>kernel scheduling<br/>file-kind detection"]
    end

    UI --> B1
    UI --> B2
    B1 <--> B2
    B1 --> C1
    B2 --> C1
    B2 --> C2
    A3 --> B1
    B1 --> D2
    B1 --> D3
    D2 --> D3
    D1 --> D2
    D3 --> D4
    D4 --> C1
```

- **Host ↔ plugin contract**: every plugin implements a `Plugin` interface
  (init/destroy/activate/deactivate/render/updateParams/getParams/compute/
  loadData/renderToScene) and receives a `PluginApi` for locale, status,
  perf reporting, notifications, file access, and project-scoped params.
- **Isolation boundary**: sandboxed plugins communicate exclusively through
  a typed RPC protocol (`src/core/sandbox.ts` + `src/core/plugin-worker.ts`).
- **WebGPU**: `src/core/gpu.ts` manages the adapter/device with a CPU
  fallback; the Rust core (`native/ergalics-core`) exposes
  `BindingDescriptor`, `ComputeKernel` (compile/dispatch/compilation_info)
  and `GpuDeviceManager` to JS via wasm-bindgen.

---

## Tech Stack

| Layer      | Choice                                                    |
| ---------- | --------------------------------------------------------- |
| UI         | React 18, react-router-dom 7, Zustand 5                   |
| Language   | TypeScript 5.7 (strict)                                   |
| Build      | Vite 6                                                     |
| 3D         | Three.js r185 (+ @types/three)                            |
| Native     | Rust → wasm32-unknown-unknown, wasm-bindgen 0.2            |
| GPU        | WebGPU / WGSL via web-sys                                  |
| SQL        | DuckDB-WASM (lazy-loaded) + Apache Arrow                   |
| Testing    | Vitest (unit) + Playwright-core (E2E, headless Edge)       |
| Docs       | VitePress (separate `docs/` workspace)                    |
| Packaging  | fflate (cspkg ZIP), lz-string (project compression)       |

---

## Getting Started

### Prerequisites

- **Node.js ≥ 20** and npm
- **Rust toolchain** with the `wasm32-unknown-unknown` target and
  `wasm-bindgen-cli` (only needed to build the native core; the frontend
  degrades gracefully when the WASM module is absent)

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

The app opens at the Vite dev server URL. The welcome page runs hardware
self-checks (WebGPU, WASM, IndexedDB) before entering the workbench, and
offers six quick-start mode cards that jump straight into the research
pages.

### Build

```bash
npm run build          # wasm → typecheck → vite build
npm run build:web      # frontend only (no WASM)
npm run build:wasm     # rebuild the Rust core into src/native
```

The production build is emitted to `dist/`. Note that `build:wasm` runs
before `vite build` so the WASM bindings are always fresh.

### Docs site

```bash
cd docs && npm install && npm run dev
```

See [Documentation](#documentation) for details.

---

## Project Layout

```
.
├── src/                      # Frontend
│   ├── core/                 #   services: storage, events, i18n, gpu, wasm,
│   │                         #   fileFormat, scene3d, sandbox, cspkg,
│   │                         #   stats (statistics kernel), io (HDF5/NetCDF/
│   │                         #   FITS/Zarr/Parquet), plot (SVG/PDF engine),
│   │                         #   repro (reproducibility + repro.lock),
│   │                         #   uncertainty (CPU + WGSL GPU engine), units,
│   │                         #   experiment, lineage, chunked, figure,
│   │                         #   notebook, package (supplement zip),
│   │                         #   model (regression), signal (FFT/filters),
│   │                         #   sweep, profiler, sql (DuckDB), report,
│   │                         #   inference (HMC/NUTS, headless), logger, …
│   ├── blocks/               #   block system (Flow mode):
│   │                         #     types · registry · compiler · executor ·
│   │                         #     ops · catalog · sample · l10n · render
│   ├── editor/               #   Block & Code modes:
│   │                         #     ir · block (Blockly) · code · codegen ·
│   │                         #     runtime (StudioApi + interpreter)
│   ├── components/blocks/    #   Flow-mode canvas, palette, node, param editor,
│   │                         #     toolbar, result preview, workbench shell
│   ├── components/editor/    #   Block/Code canvases, variable / console panels
│   ├── pages/                #   welcome (quick-start mode cards), workbench,
│   │                         #     settings, share, plugin view, figures,
│   │                         #     notebook, labs/ (runs · analysis ·
│   │                         #     uncertainty · model-lab · profiler ·
│   │                         #     reprolock · lineage · supplement),
│   │                         #     signal, sweeps, sql, report
│   ├── plugins/builtin/      #   30 core + 10 fun/utility plugins (2D + 3D)
│   ├── plugins/marketplace.ts #   marketplace catalog (tags/popularity/filters)
│   ├── stores/               #   zustand stores (app/project/plugin/settings/block/
│   │                         #     editor/experiment/lineage/chunk/figure/notebook/
│   │                         #     analysis/research/tour)
│   ├── types/                #   plugin & project & editor contracts
│   └── native/               #   generated WASM bindings (git-untracked)
├── native/ergalics-core/     # Rust core (device, compute, utils)
├── examples/
│   ├── data/                 # sample datasets used by the example plugins
│   ├── projects/             # sample `.clproj` projects (incl. Flow pipelines)
│   └── code/                 # sample Python programs for Code mode (*.py)
├── scripts/                  # build-wasm · make-example-data · E2E suites
├── tests/                    # Vitest unit tests
├── docs/                     # VitePress documentation workspace
```

---

## Standard Mode

![Standard mode — drag a file, see a visualisation](docs/studio.png)

The default landing experience. Three panels: a **left rail** that lists your
projects and plugins, a **centre viewport** that hosts whichever plugin is
active (with a drop zone on first launch), and a **right panel** that turns
the active plugin's declared parameters into reactive form fields. Files
dragged onto the centre (or onto the plugin list) are routed by extension and
magic number to a matching plugin; when more than one plugin matches, a
chooser dialog lets you decide.

This is the mode you want when you already know which plugin answers your
question and just need to point it at a file.

---

## Flow Mode

![Flow mode — a sample pipeline (Normalize → Histogram / Scatter / Summary) with live result preview](docs/flow.png)

A second workbench mode. Instead of *using* a plugin, you **compose a visual
dataflow pipeline** from built-in blocks and run it. The pipeline editor
lives on the left of the screen (palette), the canvas in the middle (nodes
+ edges), a parameter editor on the right for whichever node is selected,
and a live **result preview** at the bottom that adapts to the chosen
node's output type:

- **`RenderedView`** (any `viz.*` node) — routed through the existing plugin
  renderer (scatter, histogram, …).
- **`DataTable`** (a `stats.summary` / `stats.histogram` row) — a read-only
  table so non-viz outputs become visible too.
- **`Scalar`** — an inline value.

The graph persists into the project's `blockGraph` and rehydrates on open,
sharing the autosave/share/export pipeline that backs every `.clproj`. See
[`docs/guide/flow-mode.md`](docs/guide/flow-mode.md) for the architecture
(compiler + incremental executor + the render bridge), and the sample
pipelines under `examples/projects/`.

---

## Block Mode

![Block mode — a "Run" hat block kicks off a program that loads telemetry, normalises, and plots](docs/block.png)

A Scratch-style block editor for fully scripted programs. A single green
**「运行时 / Run」hat block** is the only entry point — anything not connected
underneath it is ignored at run time, which makes "broken code" impossible
to execute accidentally. Below the hat, blocks wire together into a
top-down script: `set df = load CSV telemetry.csv` → `set n = normalize
df column temp min-max` → `scatter df X:time Y:temp_minmax color:…`.

The run button ships a **live result preview**, **variables** panel, and
**console** panel in the right-hand cards, so each run shows you what your
data became and what got printed.

Under the hood:

- **Shared IR** (`src/editor/ir/`) is the single source of truth for both
  Block mode and Code mode. Block JSON ↔ IR round-trips in a
  Node-testable pure module.
- **IR interpreter** (`src/editor/runtime/interpreter.ts`) walks the IR
  directly and calls into the same `studio.*` API that the Flow mode
  blocks use — so `studio.plot('scatter', df, { x, y })` lands in the
  very same scatter plugin as a Flow-mode `viz.scatter` block.
- **IR → JS / Python codegen** (`src/editor/codegen/`) reuses the same IR
  to emit code, powering the "view code" overlay in the toolbar.
- **Blockly 13** (`src/editor/block/`) provides the canvas; the package
  is **lazy-loaded** so Standard/Flow first paint is unaffected (~828 KB
  chunk on demand).
- **i18n** is wired through `BKY_*` keys into Blockly's locale system
  — switching language re-creates the workspace with re-labelled blocks.

See [`docs/guide/block-mode.md`](docs/guide/block-mode.md) for the full
architecture, the 30+ built-in blocks, the 5 sample programs, and the
limitations / next steps.

---

## Code Mode

![Code mode — a Monaco Python editor backed by a Pyodide worker, with a REPL console and a live plot preview](docs/code.png)

A real Python editor for the fourth workbench mode. Code mode runs **CPython
in the browser** through a Pyodide Web Worker, so you write free-form Python
against the same `studio.*` API that block mode generates — no scaffolding,
no context switching.

- **Monaco editor** (`src/components/editor/CodeEditor.tsx`) with Python
  syntax highlighting, dark/light theming, word wrap, and `studio.*`
  autocompletion.
- **Pyodide worker runtime** (`src/core/pyodide/`) — real CPython in a Web
  Worker. The `studio` module is injected as a proper importable module
  (`sys.modules['studio']`), and project data files ship into the worker as
  `_FILES` so `studio.load('telemetry.csv')` resolves synchronously.
- **Same Studio API as block mode** — `studio.load / random / range /
  normalize / sort / select / addColumn / filter / summary / histogram /
  plot / print / notify / getParam / setParam`. `studio.plot(...)` renders
  through the exact same plugin bridge as a Flow-mode `viz.*` block, so a
  plot lands in the very same scatter / line / histogram plugin.
- **REPL** — evaluate a single Python expression or statement from the
  console input without re-running the whole program.
- **Interrupt** — stopping a run terminates and respawns the worker, so a
  runaway loop cannot hang the page.
- **9 sample programs** live as real files under `examples/code/*.py`
  (mirroring flow-mode's `examples/projects/`) and load through the
  **示例 / Examples** dialog — from one-liner scatters to a full EDA
  pipeline, a Monte-Carlo π estimation, and signal smoothing.

The IR shared with block mode (`src/editor/ir/`), the IR interpreter, and the IR → JS / Python codegen are all reused here, so block and code modes stay
consistent on the same data semantics.

**Three-mode conversion** — the shared IR is the single hub for all three
editing modes: `src/editor/flow/convert.ts` round-trips IR ↔ Flow DAG
(`irToFlow` / `flowToIR`), and `src/editor/block/convert.ts` round-trips
Blockly JSON ↔ IR (`blockJSONToIR` / `irToBlockJSON`). `src/editor/code/
parse.ts` additionally parses `studio.*` calls in a Code-mode buffer back
into the IR (`parseCodeToIR`), preserving unparsed lines as raw-code nodes.
Edit a pipeline in
Flow mode, switch to Blocks and see the same logic as Scratch blocks, then
jump to Code for the generated Python — all driven by one IR. A dedicated
`sync-threeway` unit test pins the round-trip in both directions.

See [`docs/guide/block-mode.md`](docs/guide/block-mode.md) for the
architecture; R via webR is the remaining runtime.

---

## Research Modules (科研)

The **科研** dropdown in the top bar — plus the **分析** quick-analysis
button and the welcome page's quick-start cards — opens any of the fourteen
standalone research pages. Every page shares the same lab shell (back to
workbench + tool title + unconstrained scrollable body); every module is
layered the same way: a pure-TypeScript core under `src/core/` (no React), a
Zustand store that persists into the project or IndexedDB, and a page on
top, all covered by unit tests:

| Page | Route | What it does |
| ---- | ----- | ------------ |
| Analysis | `/#/analysis` | quick charts (line / scatter / histogram / bar), descriptive statistics and t / Mann–Whitney tests with SVG/PDF export |
| Experiment Runs | `/#/runs` | auto-recorded run history (source, parameters, metrics, duration) with A/B parameter diffing |
| Uncertainty | `/#/uncertainty` | bootstrap CIs, Monte-Carlo propagation, MCMC — CPU or WGSL GPU engine (auto-selected) with R-hat / ESS diagnostics |
| Model Lab | `/#/model-lab` | OLS / logistic / ridge / polynomial fitting with coefficient tables and 2×2 residual diagnostics |
| Data Profiler | `/#/profiler` | streaming column profiles, correlation matrix, quality score + issue list, fingerprint cache |
| Signal Lab | `/#/signal` | FFT / Welch PSD, windows, Savitzky–Golay / moving-average filters, ACF/PACF, seasonal decomposition |
| Sweep Studio | `/#/sweeps` | parameter grids / lists / Latin-hypercube batch experiments with response-surface visualisation |
| SQL Workbench | `/#/sql` | DuckDB-WASM over project files: joins, aggregations, window functions; results save back with lineage |
| Report Builder | `/#/report` | narrative + figures + tables + interactive filters → one self-contained HTML file |
| Repro Lock | `/#/reprolock` | `repro.lock` export/import with five-class drift verification and one-click re-run |
| Data Lineage | `/#/lineage` | layered file→run DAG rebuilt from run records + ingestion events, rendered as an SVG canvas |
| Figure Studio | `/#/figures` | multi-panel publication figures on IEEE / Elsevier templates: panel editor with live SVG preview, captions, and SVG / PDF / PNG-600dpi export |
| Notebook | `/#/notebook` | markdown + Python cells persisted in the project; cells run on a dedicated Pyodide runtime, and notebook runs feed the experiment history |
| Supplement packaging | `/#/supplement` | paper-ready ZIP with `manifest.json` (runs + lineage + metadata form) plus optional data files and code sessions |

Two supporting kernels round out the toolset: a **unit system**
(`units.convert` / `units.check` Flow blocks + `QuantityInput`) for
dimension-safe parameters, and **chunked ingestion** that streams large
delimited files in row windows with preview + fingerprinting before a full
parse.

Runs recorded from Flow / Block / Code / Notebook / Sweeps / Uncertainty /
Model Lab all land in the same history and the same lineage graph, so the
question "which run produced this figure, from which data?" is always
answerable — and the answer ships with the paper via the supplement ZIP.

---

## Plugin System

### Built-in plugins

**Core / scientific plugins** (auto-loaded at startup, 30 total):

| Plugin               | Data                        | Capability                |
| -------------------- | --------------------------- | ------------------------- |
| Point Cloud          | `.xyz`                      | 2D canvas                 |
| Point Cloud 3D       | `.xyz`, `.dat`              | Three.js scene, height ramp |
| Particles            | `.dat`                      | 2D simulation + real WGSL compute + progress |
| Time Series          | `.csv`                      | 2D line charts            |
| Histogram            | `.dat`                      | binning + log scale       |
| Heatmap              | `.json` (grid)              | viridis ramp              |
| Image Viewer         | `.png`                      | base64 asset              |
| Contour              | `.json` (grid)              | color ramp + isolines     |
| Scatter              | `.dat`, `.csv`, `.xyz`      | 2D scatter, color channel |
| N-Body Gravity       | `.json` (bodies)            | 3D Three.js points + WGSL all-pairs gravity |
| Protein Interactions | `.json` (network)           | force-directed layout + component metrics |
| Bar Chart            | `.csv` (category, value)    | grouped bars, orientation & palette |
| Polar / Radar Plot   | `.csv` (dimension × series) | multi-series radar        |
| Network Graph        | `.csv` (source, target, weight) | force-directed layout, degree sizing |
| Bubble Chart         | `.csv` (x, y, size, color)  | bubble size + color channels |
| Violin Plot          | `.csv` (group, value)       | kernel density + box overlay |
| Sankey Diagram       | `.csv` (source, target, value) | proportional flow ribbons |
| Box Plot             | `.csv` (group, value)       | quartiles, whiskers, outliers |
| Parallel Coordinates | `.csv` (multi-variate)      | categorical coloring      |
| Error Band           | `.csv` (x, y, err)          | shaded confidence band    |
| Treemap              | `.csv` (label, size / label, parent, size) | hierarchical rectangle layout |
| QQ Plot              | `.csv`, `.dat` (single column) | normal quantile comparison + reference line |
| AI Trainer           | `.csv`, `.json` (MNIST)     | 4 models (linear / non-linear NN / logistic / CNN) with live loss curve, scatter+fit / decision boundary / digit grid |
| LBM Fluid            | `.json` (obstacle mask)     | 2-D lattice-Boltzmann channel flow (D2Q9) around an obstacle; WGSL collide + stream kernels, Kármán vortex street |
| Wave Equation        | `.json` (u / drive grids)   | 2-D finite-difference wave equation (pulse / twin-source interference / double-slit scenarios); WGSL leapfrog kernel |
| Double Pendulum      | `.json` (initial conditions) | RK4 integration with a chaos ghost twin offset by 0.001 rad — sensitive dependence made visible |
| GeoJSON Map          | `.geojson`, `.json`         | offline vector map with choropleth shading; Albers (China) / Web Mercator / equirectangular projections |
| Electromagnetism     | `.json` (charges / fields)  | draggable charges under Coulomb + Lorentz forces in a uniform B field; cyclotron spirals |
| Optics Lab           | `.json` (optical layout)    | geometric ray tracing with thin lenses, a Snell + dispersion prism, and a draggable light screen |
| Structural Mechanics | `.json` (truss members)     | pin-jointed truss with axial-force coloring, utilization readouts and overload collapse |

Simulation plugins are strictly data-driven: they start empty and never
fabricate a default scene — the flow obstacle, the wave scenario, and the
pendulum initial conditions all come from a bundled sample or a user file,
and **Reset** replays the loaded data rather than restoring a built-in.

Every core plugin ships with a sample dataset (see `examples/data/`) so a
one-click load in the **示例 / Examples** dialog produces a real
visualisation immediately. Four of the plugins that lean on a non-trivial
compute path are shown below — three WGSL compute demos and the
TF.js-powered in-browser trainer:

**N-Body Gravity** — direct-summation gravity, O(N²) per step, on the GPU.

![N-Body Gravity — a 4096-body torus ring orbiting a central mass (3D, WGSL all-pairs)](docs/Nbody.png)

**Protein Interactions** — force-directed layout of a PPI network with
component metrics.

![Protein Interactions — a force-directed layout of a 560-protein / ~1700-interaction network](docs/protein.png)

**Contour** — a 64×64 twin-peak scalar field rendered with the viridis
ramp and isolines.

![Contour — twin gaussian peaks with wavy ridge, viridis ramp + isolines](docs/field.png)

**AI Trainer** — train linear / non-linear / logistic / convolutional models
in the browser with TensorFlow.js. The top of the canvas shows the live loss
curve, and the lower panel switches between scatter+fit, a 2-D decision
boundary, and a digit grid depending on the model. Four bundled samples
(`examples/data/ai/*.csv`) cover a linear regression, a cubic+sine curve, a
two-gaussian classification, and a 200-image MNIST subset. The TF.js bundle
itself is lazy-loaded on the first click of **Train**, so the trainer is in
the auto-load registry without paying a 2 MB cost at startup.

![AI Trainer — MNIST CNN trained for 10 epochs on a 200-image synthetic digit set, grid shows predictions (green) vs. ground truth (red)](docs/AImnistcnn.png)

The simulation & geospatial plugins complete the registry — four more
data-driven engines shown below:

**LBM Fluid** — a 2-D lattice-Boltzmann channel flow (D2Q9) around an
obstacle, with WGSL collide + stream kernels. The bundled airfoil sample
shows the flow field in the Wind Flow view; inflow speed, relaxation and
lattice detail are live parameters.

![LBM Fluid — lattice-Boltzmann flow past an airfoil obstacle, Wind Flow view](docs/airplane.png)

**Wave Equation** — a 2-D finite-difference wave equation with pulse /
twin-source interference / double-slit scenarios, integrated by a WGSL
leapfrog kernel with adjustable wave speed and damping.

![Wave Equation — twin-source interference pattern, orange/blue amplitude field](docs/waveequation.png)

**Double Pendulum** — RK4 integration with a chaos ghost twin whose initial
angle differs by 0.001 rad; the HUD reads out the live ghost divergence
(137.42° in the frame below) as the two trajectories peel apart.

![Double Pendulum — two trajectories diverging, HUD reads Ghost divergence: 137.42°](docs/doublependulum.png)

**GeoJSON Map** — an offline vector map with choropleth shading by property
(`adcode` for the bundled China provinces sample), graticule, and Albers
(China) / Web Mercator / equirectangular projections.

![GeoJSON Map — China provinces choropleth in the Albers (China) projection](docs/geojsonmap.png)

Three interactive physics labs round out the scientific registry — the
flagship hands-on demos where objects are manipulated directly on the
canvas:

**Electromagnetism** — draggable charges under Coulomb + Lorentz forces in
a uniform B field (strength and direction are independent parameters).
The cyclotron sample sends same-sign charges into spirals whose radius is
set by velocity, mass and B.

![Electromagnetism — three positive charges spiraling in a uniform magnetic field (dot lattice = out-of-screen B), trails enabled](docs/Cyclotron.png)

**Optics Lab** — geometric ray tracing with thin convex/concave lenses, a
triangular prism with Snell refraction and dispersion, and a light screen;
every element can be dragged on the canvas.

![Optics Lab — a white beam dispersing through a triangular prism into a spectrum, collected on the screen](docs/light.png)

**Structural Mechanics** — a pin-jointed truss that carries its load live:
members are colored by axial force (orange = tension, cyan = compression)
with utilization readouts, and snap once overloaded until the frame
collapses.

![Structural Mechanics — a 17-member deck truss carrying two weights, members colored by axial force (orange = tension, cyan = compression)](docs/structure.png)

**Fun & utility plugins** (`autoload: false`, 10 total — loaded on demand
from the built-in panel or marketplace tab):

| Plugin            | Type    | Description                              |
| ----------------- | ------- | ---------------------------------------- |
| Mandelbrot        | fractal | Mandelbrot / Julia set browser with palettes and zoom |
| Spirograph        | art     | hypotrochoid curve art                   |
| Lissajous         | art     | animated Lissajous curves                |
| Game of Life      | toy     | classic cellular automaton (play / pause / reseed) |
| Harmonograph      | art     | curve art from summed decaying sinusoids |
| Palette Explorer  | utility | two-stop gradient preview + swatches     |
| Koch Snowflake    | fractal | recursive segment fractal                |
| Barnsley Fern     | fractal | iterated function system fern            |
| Fireworks         | toy     | particle fireworks with gravity and trails |
| Truchet Tiles     | pattern | random quarter-circle arc tiles          |

Every built-in runs the same math on CPU when WebGPU is absent — see
[GPU Compute & Native Core](#gpu-compute--native-core) and
[`docs/guide/plugins.md`](docs/guide/plugins.md) for the full list and
their compute paths.

### Third-party packages (`.cspkg`)

A package is a ZIP containing `manifest.json` plus the entry module and any
assets. Loading validates the manifest (required fields, plugin-id format,
entry path traversal, sandbox enum) and then executes the entry **inside a
Web Worker sandbox** by default:

```jsonc
{
  "id": "com.example.analyzer",
  "name": "Analyzer",
  "version": "1.2.0",
  "author": "Example Corp",
  "description": "…",
  "entry": "dist/index.js",
  "sandbox": "isolated",        // "isolated" (default) | "trusted"
  "formats": [{ "extension": ".dat" }]
}
```

- `sandbox: "isolated"` (default) — runs in a Worker: separate global scope,
  no DOM/window/store access; canvas rendering via `OffscreenCanvas`.
- `sandbox: "trusted"` — executes in the host context with full DOM access.
  Only use for packages you control.

**Limitations (documented honestly)**: workers share the origin's IndexedDB,
and the legacy fallback (`new Function` with shadowed globals) is a
best-effort approximation, **not** a security boundary. The UI warns when the
fallback is used.

---

## GPU Compute & Native Core

The Rust crate `native/ergalics-core` compiles to `wasm32-unknown-unknown`
and is bound with wasm-bindgen. Current surface:

- `GpuDeviceManager` — adapter/device acquisition with CPU-fallback option.
- `GpuBuffer` — the missing buffer half of the compute foundation: create
  with an explicit usage mask (`create_storage`, `create_readable_storage`,
  `create_uniform`), upload bytes with `write`, and read results back with
  `read` (copies into a dedicated `MAP_READ | COPY_DST` readback buffer — see
  the buffer-usage note below).
- `KernelDescriptor` + `BindingDescriptor` — describe a compute kernel and
  its buffer bindings (uniform / storage / read-only-storage, dynamic
  offsets, min binding size).
- `ComputeKernel::compile` — builds a **real** `GPUBindGroupLayout` from the
  binding descriptors, compiles the WGSL module, and creates the pipeline.
- `ComputeKernel::bind_group` — materializes a bind group (buffer *i* →
  binding *i*) from the kernel's retained layout.
- `ComputeKernel::run(queue, buffers, x, y, z)` — bind group + dispatch +
  submit in one call; `dispatch(queue, bindGroup, x, y, z)` remains for
  host-managed command encoders.
- `ComputeKernel::compilation_info()` — surfaces WGSL compile diagnostics
  (error/warning + line/column) asynchronously.
- `detect_file_kind` — magic-number file detection used by the loader.

### Host-side compute service

`src/core/gpu.ts` owns the adapter/device lifecycle (CPU fallback, OOM
tracking). On top of it, `src/core/compute.ts` exposes the **plugin-facing
compute surface** (`PluginApi.gpu`): `createBuffer` / `write` / `read`,
`compileKernel` + `compilationInfo`, and one-shot `run`. It routes through
the Rust core when the WASM module is loaded and through the raw WebGPU API
otherwise — so accelerated compute works in dev *and* production, and the
Rust core stays the reference engine.

Reusable WGSL kernels live in `src/core/wgsl.ts` (particle integration,
3-D all-pairs N-body gravity, D2Q9 lattice-Boltzmann collide/stream/curl, and
the 2-D wave-equation leapfrog), paired with host-side pack/unpack helpers
that mirror the kernel math for the CPU fallback. The Particles plugin
demonstrates the single-buffer path (upload interleaved `[x, y, vx, vy]` +
uniform params →
dispatch the WGSL integrator → read back → report real GPU time); the N-Body
plugin demonstrates the heavier all-pairs path with ping-pong buffers that keep
every integration step on the device with no per-step read-back.

> When WebGPU (or the WASM module) is unavailable, `api.gpu` is `undefined`
> and plugins fall back to CPU — same behaviour, no GPU required.

---

## Testing

Unit tests (Vitest, node environment):

```bash
npm test          # or npm run test:unit
npm run verify    # typecheck + unit tests
```

688 tests across 64 test files (686 passing, 2 skipped on GPU-less CI): file-format
detection, scientific binary
I/O (NetCDF/HDF5/FITS/Parquet/Zarr helpers), the statistics kernel
(descriptive, special functions, tests, effect sizes, corrections, power),
cspkg parsing/validation,
sandbox RPC (including an end-to-end round trip through a fake Worker),
i18n, app store, WASM retry policy, GPU compute (WGSL templates — particles,
N-Body, histogram, heatmap, point-cloud — buffer packing, CPU integrators,
service gating), built-in plugin logic, the data plugins' parsing helpers
(error-band rows, treemap hierarchy, QQ probit), the block system end-to-end
— `DataTable` ops, registry, compiler (validation/topology/type-check),
executor (incremental cache + invalidation), geometry, catalog executors,
the `viz.*` → plugin render bridge, codegen (JS/Python), three-mode IR sync (block ↔ flow ↔ code), the Pyodide worker
protocol, the structural-mechanics simulator, plugin runtime lifecycle and
recent bugfix regressions, the publication-grade plot engine, the
reproducibility kernel, and the pipeline samples that load via
`import.meta.glob`, plus the research modules — the uncertainty suite
(bootstrap, Monte-Carlo propagation, GPU-engine parity and R-hat/ESS
diagnostics), the unit system, experiment tracking (the IndexedDB runs
store), data lineage, chunked ingestion, figure composition, supplement
packaging (zip round-trip), the notebook model, Model Lab (OLS / logistic /
ridge / polynomial), the data profiler, the signal toolkit (FFT / filters /
ACF / decomposition), the sweep runner (plan expansion, metric extraction,
resume), the SQL engine (registration / query / cancellation), the report
builder (spec → HTML, escaping, runs summary) and the repro lock (build /
verify / drift).

E2E suites (Playwright-core, headless Edge) against a production preview:

```bash
npm run test:e2e
```

| Suite                | Covers                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| `smoke-test`         | boot, auto-loaded plugins, reactive params, project restore            |
| `verify-ui`          | layout, theming, canvas, plugin list                                   |
| `verify-fixes`       | all example plugins render their sample data correctly              |
| `verify-3d`          | 3D point cloud in the host Three.js scene                              |
| `verify-plugins`     | 3D↔2D surface visibility, contour, scatter, tornado sample             |
| `verify-webgpu`      | GPU compute kernels (histogram / heatmap / point cloud) + CPU fallback |
| `verify-block-mode`  | block editor: mode switch, compile, run, block → code sync             |
| `verify-code-mode`   | Monaco + Pyodide: run a Python program, console, variables, plot       |
| `verify-ai-samples`  | AI Training: load all 4 samples (linear / non-linear / logistic / MNIST) |
| `verify-ai-training` | AI Trainer: activate, TF.js train, loss curve, model-switch reset, decision boundary, MNIST CNN grid |
| `verify-research`    | research toolset: experiment tracking, lineage, Figure Studio, supplement zip, notebook cell run |

---

## Documentation

A dedicated VitePress documentation workspace lives in [`docs/`](docs/):

```bash
cd docs
npm install
npm run dev       # local documentation site
npm run build     # static site → docs/.vitepress/dist
```

The production frontend build copies the docs site into `dist/docs/`, so the
welcome page's **Docs** link works from a preview server. The docs site can
also be deployed independently (e.g. GitHub Pages).

---

## Roadmap

See [`docs/guide/roadmap.md`](docs/guide/roadmap.md) for the current status
table. Highlights:

- [x] Workbench layout, project management, file routing
- [x] 40 built-in plugins (30 core + 10 fun/utility), cspkg loading, Worker sandbox
- [x] Plugin marketplace catalog (curated tags / popularity / category filters, on-demand loading)
- [x] WebGPU device management + real compute-kernel pipeline
- [x] i18n, theming, perf monitoring, share links
- [x] Flow mode — visual dataflow pipeline (compiler + incremental executor + 37 built-in blocks + canvas UI + sample pipelines in `examples/projects/`)
- [x] Vitest unit tests + Playwright E2E suites
- [x] Plugin compute surface (`api.gpu`), WGSL templates, Particles accelerated
- [x] GPU acceleration across all example plugins (histogram/heatmap/point cloud)
- [ ] Plugin marketplace: package signing & third-party install pipeline
- [x] GitHub Actions CI (unit + E2E + Pages deploy)
- [x] Block mode (Scratch-like, Google Blockly) — see [Block Mode](docs/guide/block-mode.md). 30+ built-in blocks, shared IR with the interpreter, lazy-loaded Blockly 13, and 5 sample programs; lives behind the `Blocks` top-bar slot.
- [x] Code mode (Python via Pyodide) — Monaco editor, CPython worker runtime with a real importable `studio` module, REPL + variables, worker interrupt, and 9 sample programs under `examples/code/`; same IR shared with block mode.
- [x] Three-mode conversion — Block ↔ Flow ↔ Code round-trip through the shared IR (`src/editor/flow/convert.ts` + `src/editor/block/convert.ts`), pinned by a `sync-threeway` unit test; Code-mode buffers parse back into the IR via `src/editor/code/parse.ts`
- [x] Statistics subsystem — hypothesis tests, effect sizes, multiple-comparison corrections, power analysis (`src/core/stats/`), surfaced as 11 Flow-mode `stats.*` blocks
- [x] Scientific binary I/O — HDF5 / NetCDF / FITS / Zarr / Parquet import via a single dispatcher (`src/core/io/`)
- [x] Publication-grade plot engine with SVG/PDF export and a reproducibility kernel (`src/core/plot/`, `src/core/repro/`)
- [x] Research toolset — experiment tracking with run history, uncertainty suite (bootstrap + Monte-Carlo propagation), typed unit system, data lineage DAG, chunked ingestion, Figure Studio (`/#/figures`), supplement packaging and a mixed Markdown/Python notebook (`/#/notebook`)
- [x] Top-bar redesign (semantic action clusters), welcome quick-start mode cards, guided tour
- [x] Research tools promoted to standalone pages sharing one lab shell (`/#/runs`, `/#/analysis`, `/#/uncertainty`, `/#/model-lab`, `/#/profiler`, `/#/reprolock`, `/#/lineage`, `/#/supplement`, …)
- [x] GPU uncertainty engine — WGSL PCG32 RNG, GPU bootstrap / MCMC, R-hat + ESS diagnostics, automatic CPU fallback
- [x] Model Lab — OLS / logistic / ridge / polynomial regression with diagnostics (`src/core/model/`, `/#/model-lab`)
- [x] Data Profiler — streaming column profiles + quality score (`src/core/profiler/`, `/#/profiler`)
- [x] Signal Lab — FFT / PSD / filters / ACF-PACF / seasonal decomposition (`src/core/signal/`, `/#/signal`)
- [x] Sweep Studio — grid / list / Latin-hypercube parameter sweeps with response surfaces (`/#/sweeps`)
- [x] SQL Workbench — DuckDB-WASM over project files (`/#/sql`)
- [x] Report Builder — self-contained interactive HTML export (`/#/report`)
- [x] Repro Lock — `repro.lock` export / verify / one-click re-run (`/#/reprolock`)
- [ ] Inference Forge UI — the HMC / NUTS numeric core landed headless (`src/core/inference/`); dialog/page wiring next
- [ ] Code mode: R runtime (webR)

---

## Contributing

1. Fork the repository and create a feature branch.
2. Keep changes small and covered by tests — `npm run verify` must stay
   green, and new plugin/feature work should ship with an E2E check.
3. Run `npm run test:e2e` before opening a pull request (requires the Edge
   browser at its default install path; adjust `EDGE` in the scripts
   otherwise).
4. Regenerate WASM bindings with `npm run build:wasm` when touching
   `native/ergalics-core`.

Report bugs and feature requests via
[GitHub Issues](https://github.com/SnowLeopard-io/ErgalicsStudio/issues).

---

## License

[MIT](LICENSE) © 2026 [SnowLeopard-io](https://github.com/SnowLeopard-io)
