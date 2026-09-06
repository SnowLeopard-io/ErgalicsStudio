# Testing

Testing is treated as a first-class part of the codebase, not an
afterthought: **unit tests** cover the core logic in a node environment, and
**E2E suites** drive a production preview in a headless browser.

## Unit tests (Vitest)

```bash
npm test           # vitest run
npm run test:watch
```

Environment: `node`. Thirty-one suites, 285 tests:

| Suite                  | Covers                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `fileFormat`           | magic-number + extension detection, format matching        |
| `cspkg`                | zip parsing, manifest validation, entry execution (trusted)|
| `sandbox`              | RPC encode/decode, legacy fallback, **full worker round trip** via a fake Worker |
| `i18n`                 | locale switching, fallbacks, new sandbox keys              |
| `appStore`             | banners, notifications, perf warnings                      |
| `wasm`                 | loader retry policy (3×, 1 s) with mocked module           |
| `gpuService`           | compute-service device gating / CPU fallback               |
| `gpuCompute`           | WGSL template generation, buffer packing, CPU integrator, particles fallback |
| `builtinPlugins`       | contour grid normalization, scatter parsing                |
| `sciencePlugins`       | 3-D N-body kernel/pack/momentum conservation + plugin CPU fallback; protein force-directed layout, components, no-data guards |
| `geoPhysicsPlugins`    | fluid WGSL kernels + `fluidStepCPU` + mask parsing; wave kernel/stepping/data parsing; double-pendulum physics + initial conditions; GeoJSON parsing |
| `dataPlugins`          | error-band rows, treemap hierarchy, numeric columns, QQ probit |
| `wgsl`                 | histogram / heatmap / point-cloud GPU kernels: WGSL output, param packing, output sizing, CPU fallback parity |
| `blocks/*`             | block system end-to-end — registry, compiler (validation/topology/types), executor (incremental cache + invalidation), DataTable ops, geometry, statistics, catalog executors, `viz.*` render bridge |
| `editor/*`             | shared IR (validate/round-trip), Blockly JSON ⇄ IR, interpreter, JS/Python codegen, three-mode `sync-threeway`, block i18n (`BKY_*`), editor store, Studio API, code samples |
| `stats/*`, `io/*`, `plot/*`, `repro/*` | statistical test helpers, NetCDF I/O, plotting helpers, reproducibility |

Notable techniques:

- **Module-level caches** (e.g. the WASM loader) are reset per test with
  `vi.resetModules()` + `vi.doMock` + a fresh dynamic `import`.
- **Worker RPC** is tested end-to-end with a `FakeWorker` that drives the
  real `createPluginWorkerRuntime` — no browser required.
- **Strict-mode `new Function`** cannot combine a `"use strict"` directive
  with default parameter values — the legacy sandbox uses plain parameters
  and passes `undefined` explicitly.

## E2E suites (Playwright-core)

```bash
npm run test:e2e
```

Each suite boots `vite preview` on its own port, drives headless Edge
(`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` by default),
and asserts real pixels + zero console errors:

| Suite            | Port | Covers                                                     |
| ---------------- | ---- | ---------------------------------------------------------- |
| `smoke-test`     | 4173 | boot, auto-loaded plugins, reactive params, project restore|
| `verify-ui`      | 4173 | layout metrics, theming, canvas visibility                 |
| `verify-fixes`   | 4177 | all example plugins render their sample data correctly  |
| `verify-3d`      | 4199 | 3D point cloud in the host Three.js scene                  |
| `verify-plugins` | 4198 | 3D↔2D surface visibility, contour, scatter, tornado sample |
| `verify-webgpu`  | 4289 | real WebGPU path in headless Edge (SwiftShader): numeric harness (GPU vs CPU integrator within ~2e-6) + Particles app integration asserting a `wasm`-engine toast |
| `verify-block-mode` | 4173 | block editor: mode switch, compile, run, block → code sync |
| `verify-code-mode`  | 4175 | Monaco + Pyodide: run a Python program, console, variable panel, plot canvas |
| `verify-ai-samples` | 4173 | AI Training: load all 4 samples (linear / non-linear / logistic / MNIST) |
| `verify-ai-training`| 4173 | AI Trainer: activate, TF.js train, loss curve, model-switch reset, decision boundary, MNIST CNN grid |

> If Edge is not at the default path, update the `EDGE` constant in each
> script. New plugin/feature work should ship with an E2E check — screenshots
> are written under the temp `opencode/shots` directory for visual review.

## Combined checks

```bash
npm run verify       # typecheck + unit tests
npm run build        # wasm + typecheck + production build
```
