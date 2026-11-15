# Migration Guide: Experimental v0 → SDK v1

> **Audience**: Plugins written before the SDK freeze (2026-09-12, host commit `c7b7327`).
> **Related documents**: [v1 contract](./v1-contract) (the sole restatement of the freeze scope and compatibility commitments) · [Plugin development guide](../guide/plugins) (tutorials and examples)

During the experimental period (v0, beginning with initial commit `f1aeeed` on 2026-08-13), the contract was extended several times. At the v1 freeze, changes fell into two categories:

1. **Relaxed constraints** (required in v0 → optional in v1, synchronous → optionally asynchronous) — the vast majority of v0 plugins can run on a v1 host **without changes**.
2. **New capabilities** (sandboxing, GPU, caching, signing, etc.) — adopt them as needed; not adopting them does not break anything.

There are **no breaking changes**: no v0 members were removed or renamed. The following sections compare them in detail.

## Contents {#目录}

1. [Version-by-version timeline](#一逐版本演进时间线)
2. [Lifecycle: required → optional](#二生命周期必需--可选)
3. [Relaxed asynchronous returns](#三异步返回放宽)
4. [Concrete Scene3DHandle types](#四scene3dhandle-类型具体化)
5. [New members at a glance](#五新增成员一览)
6. [Migration checklist](#六迁移检查清单)

---

## 1. Version-by-version timeline {#一逐版本演进时间线}

| Host commit | Date | Contract change |
| --- | --- | --- |
| `f1aeeed` | 2026-08-13 | Initial v0 contract: basic `PluginManifest` fields, 7 parameter control types, `Plugin` lifecycle (`destroy`/`activate`/`deactivate`/`updateParams` **required**), `Scene3DHandle` fields typed as `unknown` |
| `659c6b6` | 2026-08-14 | Added `manifest.sandbox` (`isolated`/`trusted`) and `api.notify()`; 3D scene support introduced |
| `761132d` | 2026-08-14 | Added `api.gpu` (`GpuComputeApi`, `ComputeBufferHandle`, `GpuKernelDescriptor`, `GpuKernelHandle`) |
| `dd49922` | 2026-08-16 | Added the eighth parameter control type, `toggle` (including `on/offLabelI18n`) |
| `b2e014c` | 2026-08-17 | Added `manifest.category` (`scientific`/`fun`/`utility` marketplace groups) |
| `c7b7327` | 2026-09-12 | **v1 freeze**: added `api.log` / `api.cache` / `api.exportFile`, `manifest.signature` (FR-05), and `PluginRunRecord` / `ParameterSnapshot` observation records; added `nameI18n` / `descriptionI18n` to `PluginRegistryEntry`; relaxed lifecycle requirements (see below) |

---

## 2. Lifecycle: required → optional {#二生命周期必需--可选}

Four members of the `Plugin` interface were **required** in v0; v1 makes them optional (the host checks and calls them using `?.`):

| Member | v0 | v1 | Migration notes |
| --- | --- | --- | --- |
| `destroy()` | Required | Optional | Empty implementations may be removed; keep those that release resources. |
| `activate(context)` | Required | Optional | As above. In v1, a minimal third-party package may implement only `render`. |
| `deactivate()` | Required | Optional | As above. |
| `updateParams(params)` | Required | Optional | Plugins that do not consume parameter updates may remove it. |

The three members that remain **required** are unchanged: `manifest`, `init(api)`, and `getParams()`.

> A v0 plugin retaining these four methods runs normally on a v1 host: relaxing the requirement means they may be omitted, not that they are forbidden.

## 3. Relaxed asynchronous returns {#三异步返回放宽}

| Member | v0 signature | v1 signature |
| --- | --- | --- |
| `getParams` | `() => ParamDefinition[]` | `() => ParamDefinition[] \| Promise<ParamDefinition[]>` |
| `getSupportedFormats` | `() => SupportedFormat[]` | `() => SupportedFormat[] \| Promise<SupportedFormat[]>` |

Synchronous v0 implementations need no changes. v1 permits asynchronous returns — for example, when a parameter table first needs to warm up with `await api.cache.get(...)`.

## 4. Concrete Scene3DHandle types {#四scene3dhandle-类型具体化}

In v0, the `scene` / `camera` / `controls` / `renderer` fields of `Scene3DHandle` were typed as `unknown`, requiring assertions in plugins. v1 freezes them as actual Three.js types:

| Field | v0 | v1 |
| --- | --- | --- |
| `scene` | `unknown` | `three.Scene` |
| `camera` | `unknown` | `three.PerspectiveCamera` |
| `controls` | `unknown` | `three.OrbitControls` |
| `renderer` | `unknown` | `three.WebGLRenderer` |

Migration notes:

- Plugins that previously wrote `const s = handle.scene as any` can remove the assertion and receive type checking directly.
- Code asserting a different shape (for example, an extended type incorrectly treated as `THREE.Group`) may produce compilation errors in v1 strict mode; correct it to match the v1 types.
- The host attaches the `three` handle **only when `renderToScene` is declared** (`ContainerCapabilities.three` is optional); `three` / `dom` are intentionally unavailable inside the `isolated` sandbox.

## 5. New members at a glance {#五新增成员一览}

The following members did not exist in v0 and were added in v1. All are **optional** or require **capability detection**, so v0 plugins continue to work without knowing about them:

| Surface | Added | Adoption guidance |
| --- | --- | --- |
| manifest | `sandbox`, `category`, `signature` (injected by the host), `nameI18n` / `descriptionI18n`, `license` / `icon` / `homepage` / `dependencies` / `formats` | Keep third-party distributions `isolated` (the safe default); add `category` and i18n for marketplace display. |
| Parameter controls | Eighth type: `toggle` | Prefer `toggle` (with `on/offLabel`) for on/off switches; use `checkbox` for ordinary booleans. |
| PluginApi | `notify`, `log`, `cache`, `exportFile`, `gpu?`, `reload?` | Use `api.log` instead of `console.*` (exported with run logs and reproducible); check `gpu.available` and provide CPU fallback. |
| Lifecycle | `compute`, `loadData`, `renderToScene`, `onProjectSave`, `onProjectLoad`, `reload?()` | Data-driven plugins implement `loadData` + `getSupportedFormats`; use `onProjectSave/Load` for project persistence hooks; use `reload()` to recover from a hang (unload → recreate from factory → reactivate). |
| Observability (host side) | `PluginRunRecord`, `ParameterSnapshot`, `PluginInstallState`, `PluginRegistryEntry.nameI18n/descriptionI18n` | Consume read-only; no migration required. |

See the [v1 contract](./v1-contract) for complete signatures.

## 6. Migration checklist {#六迁移检查清单}

Go through each item to confirm that a v0 plugin fully aligns with v1:

- [ ] **Entry semantics are unchanged**: The `.cspkg` entry is still a **function body** (executed by the host using `new Function('api', src)`) and must `return { manifest, init, getParams, ... }` — it is not ESM; do not use `import` / `export`. Replace a top-level `export default` in v0 code with an explicit `return`.
- [ ] **Always `await` calls across the sandbox bridge**: In the `isolated` sandbox, `getParam` / `setParam` / `cache.*` cross the RPC bridge and resolve as Promises (the host signatures are synchronous). If v0 code directly consumes the return value of `api.getParam(key)` as `unknown`, it receives a Promise in the sandbox — always `await` it; this works in both sandboxes.
- [ ] **`api.cache` is entirely asynchronous**: `get/set/delete/clear/keys` all return Promises; there are no synchronous variants.
- [ ] **Check `api.gpu` for existence and `available`**: It is always `undefined` in the `isolated` sandbox; even in `trusted` it exists only when a WebGPU device is available. Always provide a CPU fallback branch.
- [ ] **GPU buffers must be `destroy()`ed**: Release handles returned by `createBuffer` after use; otherwise each compute leaks device memory until the device is destroyed.
- [ ] **`container.three` exists only after declaring `renderToScene`**: Do not access it without declaring the method; check for its presence before use.
- [ ] **Optional lifecycle methods may be removed**: Empty `destroy` / `activate` / `deactivate` / `updateParams` implementations may be removed; the host no longer requires them.
- [ ] **Choose one of two distribution paths**: Direct use of `trusted` is suitable only for in-house packages; third-party packages should retain the default `isolated`. `.cspkg` installation is subject to gates (size / file count / id / entry path); see [v1 contract §3](./v1-contract#三、签名与分发-cspkg).
- [ ] **Add signatures as needed**: Unsigned v0 packages can still be installed (a “trust this source” confirmation appears); sign with `node scripts/sign-cspkg.mjs` to remove the confirmation (Node ≥ 23.6).
- [ ] **Adopt i18n**: Keep English fallbacks in plain `name` / `label` fields; put Chinese text in `*I18n` dictionaries (the `'zh-CN'` key).

After these checks, the v0 plugin qualifies as a v1 package; there is no need to relearn any API — v1 simply standardizes and freezes v0's actual behavior.
