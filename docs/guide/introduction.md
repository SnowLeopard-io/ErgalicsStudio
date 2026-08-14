# Introduction

**Ergalics Studio** is an industrial-grade scaffold for a professional
scientific-computing workstation that runs entirely in the browser. It pairs
a React + TypeScript frontend with a Rust core compiled to WebAssembly and a
WebGPU compute pipeline, and it treats third-party extensibility as a
first-class concern.

## Goals

- **Browser-native**: no install, no server required; data lives in
  IndexedDB and can be shared as `.clproj` files.
- **Extensible by design**: every visualization is a plugin behind a small,
  typed contract; third-party packages are isolated from the host page.
- **Industrial hygiene**: strict TypeScript, unit + E2E tests, a deterministic
  example-data pipeline, and generated, versioned WASM bindings.

## Current state

The project is in the **planning stage**. The following are functional today:

- The full workbench loop: projects, file routing, plugin registry,
  parameter panels, status/perf bars.
- Eight example plugins covering the 2D and 3D rendering paths.
- A real WebGPU compute pipeline: `GpuBuffer` management and kernel
  compile/dispatch/run from Rust, an `api.gpu` compute surface for plugins,
  reusable WGSL templates, and the Particles plugin accelerated by a WGSL
  kernel with a CPU fallback.
- A Worker-based plugin sandbox with a typed RPC protocol.
- i18n, theming, sharing, and automated tests (unit + E2E).

Not yet built: GPU acceleration across the remaining example plugins, a
plugin marketplace with package signing, and CI automation.

> The intent is that the scaffold grows into a production system by adding
> features **into** this structure — not by rewriting it.
