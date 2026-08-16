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
- **Three workbench modes** — Standard (drag → see), Flow (compose a
  dataflow DAG → run), and Block (Scratch-style scripted editor with a
  Run hat, 30+ built-in blocks, shared IR, and 5 sample programs). The
  Code slot is wired through the same IR and reserved for Python/R.
- Eleven example plugins covering the 2D and 3D rendering paths — including
  a 3-D N-body gravity simulator (astrophysics) and a protein interaction
  network with force-directed layout (systems biology).
- A real WebGPU compute pipeline: `GpuBuffer` management and kernel
  compile/dispatch/run from Rust, an `api.gpu` compute surface for plugins,
  reusable WGSL templates, and two accelerated plugins with CPU fallbacks —
  Particles (single-buffer integration) and N-Body Gravity (3-D all-pairs
  with ping-pong buffers).
- A Worker-based plugin sandbox with a typed RPC protocol.
- i18n (zh-CN / en-US) with reactive locale switching — Block mode uses
  Blockly's `BKY_*` key system so block labels re-localise with the rest.
- Theming (dark / light), sharing, and automated tests (196 unit tests
  across 24 suites plus block-mode Playwright smoke).

Not yet built: GPU acceleration across the remaining example plugins
(histogram binning, heatmap/contour grids, point-cloud transforms), a
plugin marketplace with package signing, CI automation, and the Code mode
(Python/R) on top of the existing IR.

> The intent is that the codebase keeps growing into a production system by
> adding features **into** this structure — not by rewriting it.
