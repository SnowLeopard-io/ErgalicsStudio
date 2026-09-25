# Introduction

**Ergalics Studio** is a professional scientific-computing workstation that
runs entirely in the browser. It pairs a React + TypeScript frontend with a
Rust core compiled to WebAssembly and a WebGPU compute pipeline, and it
treats third-party extensibility as a first-class concern.

## Goals

- **Browser-native**: no install, no server required; data lives in
  IndexedDB and can be shared as `.clproj` files.
- **Extensible by design**: every visualization is a plugin behind a small,
  typed contract; third-party packages are isolated from the host page.
- **Industrial hygiene**: strict TypeScript, unit + E2E tests, a deterministic
  example-data pipeline, and generated, versioned WASM bindings.

## Current state

The project is under **active development** and already usable end to end.
The following are functional today:

- The full workbench loop: projects, file routing, plugin registry,
  parameter panels, status/perf bars.
- **Four workbench modes** — Standard (drag → see), Flow (compose a
  dataflow DAG → run), Block (Scratch-style scripted editor with a Run
  hat, 40+ built-in blocks, shared IR, and 5 sample programs), and Code
  (free-form Python on a Pyodide CPython Worker, with a REPL console and
  9 sample programs). All three scripted modes share one IR, and Block ↔
  Flow ↔ Code round-trip is pinned by a `sync-threeway` test.
- **59 built-in plugins** (49 scientific + 10 fun/utility) covering the 2D and
  3D rendering paths — including a 3-D N-body gravity simulator
  (astrophysics), a protein interaction network with force-directed layout
  (systems biology), D2Q9 lattice-Boltzmann fluid / wave-equation /
  double-pendulum simulations, an offline GeoJSON choropleth map, three
  interactive physics labs (electromagnetism, optics, structural
  mechanics), an
  in-browser AI trainer (linear / non-linear NN / logistic / MNIST CNN on
  TensorFlow.js), and two field-grade competition solvers: a sparse
  Hermitian eigenvalue solver (`em-eigensolver`) and a 1D–3D bidirectional
  fluid-network coupler (`fluid-cfd-coupler`), both run inside Pyodide
  workers with millisecond-level control tooling.
- Scientific computing subsystems in pure TypeScript: a statistics kernel
  (hypothesis tests, effect sizes, corrections, power analysis), scientific
  binary I/O (HDF5 / NetCDF / FITS / Zarr / Parquet), a publication-grade
  SVG/PDF plot engine, and a reproducibility kernel (seeded RNG + run
  manifests).
- A real WebGPU compute pipeline: `GpuBuffer` management and kernel
  compile/dispatch/run from Rust, an `api.gpu` compute surface for plugins,
  and reusable WGSL templates with CPU fallbacks — accelerating Particles,
  N-Body Gravity, the LBM fluid, the wave equation, histogram, heatmap and
  point-cloud kernels.
- A Worker-based plugin sandbox with a typed RPC protocol.
- i18n (zh-CN / en-US) with reactive locale switching — Block mode uses
  Blockly's `BKY_*` key system so block labels re-localise with the rest.
- Theming (dark / light), sharing, GitHub Actions CI, and automated tests
  (2233 Vitest unit tests across 123 test files plus Playwright E2E suites).

Built but not yet shipped as a product: the fully-automated third-party
submission & install pipeline for the plugin marketplace (the `.cspkg`
package-signing gate — ed25519, FR-05 — is already live; see `SECURITY.md`).
R for Code mode is a full webR runtime (vendored in `public/webr/`, falling
back to the built-in IR engine when the bundle is absent) — see `guide/roadmap`.

> The intent is that the codebase keeps growing into a production system by
> adding features **into** this structure — not by rewriting it.
