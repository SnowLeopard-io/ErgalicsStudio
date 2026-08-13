# Testing

Testing is treated as part of the scaffold, not an afterthought: **unit
tests** cover the core logic in a node environment, and **E2E suites** drive
a production preview in a headless browser.

## Unit tests (Vitest)

```bash
npm test           # vitest run
npm run test:watch
```

Environment: `node`. Seven suites, 50+ tests:

| Suite                  | Covers                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `fileFormat`           | magic-number + extension detection, format matching        |
| `cspkg`                | zip parsing, manifest validation, entry execution (trusted)|
| `sandbox`              | RPC encode/decode, legacy fallback, **full worker round trip** via a fake Worker |
| `i18n`                 | locale switching, fallbacks, new sandbox keys              |
| `appStore`             | banners, notifications, perf warnings                      |
| `wasm`                 | loader retry policy (3×, 1 s) with mocked module           |
| `builtinPlugins`       | contour grid normalization, scatter parsing                |

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
| `verify-fixes`   | 4177 | all 8 example plugins render their sample data correctly   |
| `verify-3d`      | 4199 | 3D point cloud in the host Three.js scene                  |
| `verify-plugins` | 4198 | 3D↔2D surface visibility, contour, scatter, tornado sample |

> If Edge is not at the default path, update the `EDGE` constant in each
> script. New plugin/feature work should ship with an E2E check — screenshots
> are written under the temp `opencode/shots` directory for visual review.

## Combined checks

```bash
npm run verify       # typecheck + unit tests
npm run build        # wasm + typecheck + production build
```
