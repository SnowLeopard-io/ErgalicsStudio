# Roadmap & Status

The project is in the **planning stage**. This table reflects the actual
state of the codebase (verified by the test suites), not aspirational
designs.

## Module status

| Module        | Features                                                       | Status       |
| ------------- | -------------------------------------------------------------- | ------------ |
| Welcome page  | hardware self-checks, language/theme switcher, enter workbench | ✅ Done      |
| Workbench     | four-region layout, empty state, drag & drop, status bar       | ✅ Done      |
| Plugin system | load/activate/unload, registry, built-ins, cspkg + sandbox     | ✅ Done      |
| Projects      | create/save/open/autosave/share `.clproj`                      | ✅ Done      |
| Data loading  | file picker / drag & drop / format detection / routing         | ✅ Done      |
| Rendering     | 2D canvas + host Three.js scene (lazy, visibility-managed)     | ✅ Done      |
| i18n          | zh-CN / en-US, detection, reactive switching                   | ✅ Done      |
| Theming       | dark/light, system-follow, CSS variables                       | ✅ Done      |
| Settings      | general / GPU / data / about                                   | ✅ Done      |
| Perf monitor  | FPS / frame / GPU / memory / data-scale + warnings             | ✅ Done      |
| Sharing       | link generation, project export                                | ✅ Done      |
| Native core   | device mgmt, compute kernel (compile/dispatch/diagnostics)     | ✅ Core done |
| GPU compute   | WGSL kernels driving the example plugins                       | 🚧 Next      |
| Marketplace   | plugin registry UI, package signing, remote install            | 🚧 Next      |
| CI            | GitHub Actions (unit + E2E + Pages deploy)                     | 🚧 Next      |
| Error handling| error boundaries, fallbacks, retry                            | 🟡 Partial   |

## Milestones

1. **M1 — Solidify the scaffold** *(current)*: complete the plugin
   lifecycle, sandbox, and test coverage; land the docs site.
2. **M2 — Real GPU compute**: move the example plugins from simulated
   progress to actual WGSL kernels (particles first), expose buffers and
   bind groups through the plugin API, and add GPU perf telemetry.
3. **M3 — Marketplace**: package registry, versioning, signature
   verification, and in-app install/update flows.
4. **M4 — CI + release**: GitHub Actions pipeline, artifact publishing,
   and the docs site deployed to Pages.

## Known limitations (honest)

- The plugin sandbox isolates the page context (globals, DOM, stores) but
  workers share the origin's IndexedDB — a malicious package could still
  read app data. Package signing is planned for M3.
- The legacy `new Function` fallback (when Workers are unavailable) is not a
  security boundary; the UI warns when it is used.
- The WebGPU compute path requires a WebGPU-capable browser; without one the
  app runs in CPU-fallback mode.
