# Roadmap & Status

The project is under **active development** — every box marked ✅ here is in
the codebase and covered by the test suites. This table reflects the actual
state, not aspirational designs.

## Module status

| Module        | Features                                                       | Status       |
| ------------- | -------------------------------------------------------------- | ------------ |
| Welcome page  | hardware self-checks, language/theme switcher, enter workbench | ✅ Done      |
| Workbench     | four-region layout, empty state, drag & drop, status bar       | ✅ Done      |
| Plugin system | load/activate/unload, registry, built-ins, cspkg + sandbox     | ✅ Done      |
| Projects      | create/save/open/autosave/share `.clproj`                      | ✅ Done      |
| Data loading  | file picker / drag & drop / format detection / routing         | ✅ Done      |
| Rendering     | 2D canvas + host Three.js scene (lazy, visibility-managed)     | ✅ Done      |
| Flow mode     | compiler (validate/topology) + executor (incremental cache) + 23 built-in blocks + Flow canvas + result preview + sample pipelines | ✅ Done      |
| Block mode    | shared IR + Blockly 13 (lazy-loaded) + interpreter + JS / Python codegen + 30+ built-in blocks + 5 sample programs + `studio.*` API reusing Flow ops + i18n via `BKY_*` | ✅ Done      |
| i18n          | zh-CN / en-US, detection, reactive switching, Blockly `BKY_*`  | ✅ Done      |
| Theming       | dark/light, system-follow, CSS variables                       | ✅ Done      |
| Settings      | general / GPU / data / about                                   | ✅ Done      |
| Perf monitor  | FPS / frame / GPU / memory / data-scale + warnings             | ✅ Done      |
| Sharing       | link generation, project export                                | ✅ Done      |
| Native core   | device mgmt, `GpuBuffer`, compute kernel (compile/bind-group/dispatch/run/diagnostics) | ✅ Core done |
| GPU compute   | `api.gpu` compute surface, WGSL templates, particles + 3-D N-body plugins accelerated (CPU fallback), real-device E2E verification | 🟡 Partial  |
| Code mode     | Monaco + Pyodide (Python) + webR (R) on top of the existing IR, with bidirectional block ↔ code sync | 🚧 Next |
| Marketplace   | plugin registry UI, package signing, remote install            | 🚧 Next      |
| CI            | GitHub Actions (unit + E2E + Pages deploy)                     | 🚧 Next      |
| Error handling| error boundaries, fallbacks, retry                            | 🟡 Partial   |

## Milestones

1. **M1 — Solidify the foundations** *(current)*: complete the plugin
   lifecycle, sandbox, and test coverage; land the docs site.
2. **M2 — Real GPU compute**: the foundations are in place — the native core
   exposes `GpuBuffer` + `ComputeKernel::run`, the plugin API ships an
   `api.gpu` compute surface, reusable WGSL templates live in
   `src/core/wgsl.ts`, and two plugins run real WGSL kernels with CPU
   fallbacks: Particles (single-buffer integration) and N-Body Gravity (3-D
   all-pairs with ping-pong buffers). `npm run test:e2e` now drives the real
   WebGPU path in headless Edge (SwiftShader): a numeric harness compares the
   GPU result against the CPU integrator (passing within ~2e-6), and an app
   integration step clicks through the Particles plugin and asserts a
   `wasm`-engine GPU toast. Remaining: accelerate the remaining example
   plugins (histogram binning, heatmap/contour grids, point-cloud transforms)
   and add GPU perf telemetry per kernel.
3. **M3 — Code mode**: Python (Pyodide) and R (webR) running behind
   Monaco, sharing the existing IR with Block mode for bidirectional sync,
   plus an `IR → Python` / `IR → R` codegen pass and a Worker-side runner.
4. **M4 — Marketplace**: package registry, versioning, signature
   verification, and in-app install/update flows.
5. **M5 — CI + release**: GitHub Actions pipeline, artifact publishing,
   and the docs site deployed to Pages.

## Known limitations (honest)

- The plugin sandbox isolates the page context (globals, DOM, stores) but
  workers share the origin's IndexedDB — a malicious package could still
  read app data. Package signing is planned for M4.
- The legacy `new Function` fallback (when Workers are unavailable) is not a
  security boundary; the UI warns when it is used.
- The WebGPU compute path requires a WebGPU-capable browser; without one the
  app runs in CPU-fallback mode.
- Block mode resolves `studio.load(...)` against `examples/data/` only;
  drag-and-drop files do not yet land in `ProjectState.data.files` (so a
  project that opened a CSV in Standard mode cannot re-read it from a Block
  session). Tracked under M3.
- Block mode and the IR are designed so a `gpu.*` family of nodes slots in
  later; the worker-side runner and the `ComputeKernel` dispatch from a
  block are not yet wired.
