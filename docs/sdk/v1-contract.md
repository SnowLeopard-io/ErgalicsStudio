# Plugin SDK v1 Contract (FR-22)

> **Status**: v1 is frozen. The API surface listed here is covered by compatibility commitments starting with Ergalics Studio host version 1.x.
> **Single source of truth**: `src/types/plugin.ts` (the TypeScript contract definition). This document is a normalized restatement; if the two differ, `src/types/plugin.ts` takes precedence, and please report the discrepancy.
> **Related documents**: [Migration guide](./migration) (experimental v0 → v1) · [Plugin development guide](../guide/plugins) (tutorials and examples) · [Official starter template](https://github.com/SnowLeopard-io/ErgalicsStudio/tree/main/templates/plugin-starter)

## Contents {#目录}

1. [Frozen surface](#一、冻结范围清单)
2. [Compatibility commitments and deprecation policy](#二、兼容性承诺与弃用策略)
3. [Signing and distribution (.cspkg)](#三、签名与分发-cspkg)
4. [Theme package (.cstheme) boundary](#四、主题包-cstheme-边界)

---

## I. Frozen surface {#一、冻结范围清单}

The following types and members constitute the **stable surface of SDK v1**. Labels mean:

| Label | Meaning |
| --- | --- |
| Stable | Signature and semantics are frozen within v1; the host guarantees no breakage. |
| Optional | Field/method may be omitted; the host checks with `?.` before calling. Adding optional members is an “extension,” not a breaking change. |
| Host-side | Plugins consume these read-only (constructed by the host); their shape is also frozen. |

### 1.1 Plugin manifest `PluginManifest` {#_1-1-插件清单-pluginmanifest}

| Field | Type | Stability | Description |
| --- | --- | --- | --- |
| `id` | `string` | Stable (required) | Globally unique id. Validated against `^[a-z0-9][a-z0-9._-]{0,63}$` (case-insensitive) when installing a `.cspkg`. |
| `name` | `string` | Stable (required) | Display name |
| `version` | `string` | Stable (required) | Plugin's own version (semver recommended, not strictly validated by the host) |
| `author` | `string` | Stable (required) | Author |
| `description` | `string` | Stable (required) | Description |
| `entry` | `string` | Stable (required) | Entry descriptor: symbolic id for built-in plugins; **package-relative path** for `.cspkg` (`validateManifest` rejects absolute paths, drive letters, and `..`). |
| `license` | `string?` | Optional | SPDX string |
| `icon` | `string?` | Optional | Icon |
| `homepage` | `string?` | Optional | Homepage |
| `dependencies` | `Record<string,string>?` | Optional | Declarative dependencies |
| `formats` | `SupportedFormat[]?` | Optional | Supported data formats (used for file routing) |
| `category` | `'scientific' \| 'fun' \| 'utility'?` | Optional | Marketplace group |
| `sandbox` | `'isolated' \| 'trusted'?` | Optional | Execution context; defaults to `isolated` (Web Worker sandbox); `trusted` is only for in-house packages. |
| `nameI18n` | `Record<string,string>?` | Optional | Display name by locale (see 1.6) |
| `descriptionI18n` | `Record<string,string>?` | Optional | Description by locale |
| `signature` | `PluginSignature?` | Optional (host-injected) | ed25519 package signature for `.cspkg` (FR-05); omitted = unsigned. |

`SupportedFormat` (stable): `extension: string`, `mimeTypes: string[]`, `magic?: number[]` (byte prefix), `description?: string`.

`PluginSignature` (stable, between host and signing tool; not constructed by plugins): `alg: 'ed25519'`, `fingerprint: string` (`ed25519:<hex32>`), `sig: string` (128 hexadecimal digits), `signer: string`, `signedAt: string` (ISO-8601), `permissions?: string[]`, `pub?: string` (optional embedded public key, cross-checked against fingerprint during verification).

### 1.2 Lifecycle `Plugin` {#_1-2-生命周期-plugin}

The plugin module entry must produce an object implementing the `Plugin` interface.

| Member | Signature | Stability |
| --- | --- | --- |
| `manifest` | `readonly PluginManifest` | **Stable (required)** |
| `init` | `(api: PluginApi) => Promise<void> \| void` | **Stable (required)** |
| `getParams` | `() => ParamDefinition[] \| Promise<ParamDefinition[]>` | **Stable (required)** |
| `destroy` | `() => Promise<void> \| void` | Optional |
| `activate` | `(context: PluginRenderContext) => Promise<void> \| void` | Optional |
| `deactivate` | `() => Promise<void> \| void` | Optional |
| `render` | `(container: ContainerCapabilities) => Promise<void> \| void` | Optional |
| `updateParams` | `(params: Record<string, unknown>) => Promise<void> \| void` | Optional |
| `compute` | `(input: unknown, onProgress?: (p: ComputeProgress) => void) => Promise<ComputeResult>` | Optional |
| `loadData` | `(file: File) => Promise<void> \| void` | Optional |
| `getSupportedFormats` | `() => SupportedFormat[] \| Promise<SupportedFormat[]>` | Optional |
| `renderToScene` | `(scene: Scene3DHandle) => Promise<void> \| void` | Optional (the host mounts a Three.js scene only when declared) |
| `onProjectSave` | `() => Promise<void> \| void` | Optional (triggered after successful project persistence, best effort) |
| `onProjectLoad` | `() => Promise<void> \| void` | Optional (triggered after project state restoration, best effort) |

Everything except `manifest` / `init` / `getParams` is optional—a minimal third-party package may implement only `render`.

`PluginRenderContext` (stable): `{ container: ContainerCapabilities; api: PluginApi }`.

### 1.3 Parameter schema `ParamDefinition` {#_1-3-参数-schema-paramdefinition}

A discriminated union of **8 control types** (`type` is the discriminator). All members share `BaseParam` (stable): `key: string`, `label: string`, `labelI18n?: Record<string,string>`, `type: ParamControlType`, `hint?: string`.

| `type` | Type-specific fields | Stability |
| --- | --- | --- |
| `range` | `min` `max` `step` `value` (all `number`) | Stable |
| `select` | `options: SelectOption[]`, `value: string`; `SelectOption = { value, label, labelI18n? }` | Stable |
| `number` | `min?` `max?` `step?`, `value: number` | Stable |
| `checkbox` | `value: boolean` | Stable |
| `text` | `value: string`, `placeholder?: string` | Stable |
| `file` | `accept: string`, `value: string \| null` | Stable |
| `button` | `variant?: 'primary' \| 'danger' \| 'default'`, `action?: string` (sent back via `updateParams` when triggered) | Stable |
| `toggle` | `value: boolean`, `offLabel?` `onLabel?`, `offLabelI18n?` `onLabelI18n?` | Stable |

The host uses this to generate the responsive right-side parameter panel automatically; user edits are sent back through `updateParams`.

### 1.4 Container capabilities `ContainerCapabilities` and `Scene3DHandle` {#_1-4-容器能力-containercapabilities-与-scene3dhandle}

`ContainerCapabilities` (host-side, stable):

| Member | Type | Stability |
| --- | --- | --- |
| `three` | `Scene3DHandle?` | Optional—mounted by the host only when the plugin declares `renderToScene` |
| `canvas2d` | `HTMLCanvasElement?` | Optional—shared 2D canvas |
| `dom` | `HTMLDivElement?` | Optional—general DOM container (unavailable inside the `isolated` sandbox) |
| `reportDataScale` | `(n: number) => void` | Stable—reports data scale to the performance panel |

`Scene3DHandle` (live handle to a host-managed Three.js scene, stable):

| Member | Type | Description |
| --- | --- | --- |
| `scene` | `three.Scene` | Root node; add meshes/lights |
| `camera` | `three.PerspectiveCamera` | Host-provided camera position |
| `controls` | `three.OrbitControls` | Orbit controller (host provides input interaction; plugins need not write control code) |
| `renderer` | `three.WebGLRenderer` | Bound to the host canvas |
| `setVisible(visible)` | `(boolean) => void` | Show/hide the 3D surface (host automatically hides it when switching to a non-3D plugin) |
| `isVisible()` | `() => boolean` | Whether currently visible |
| `render()` | `() => void` | Render one frame immediately |
| `snapshot()` | `() => string` | Current frame as a PNG data URL |
| `dispose()` | `() => void` | Release GPU resources and stop the rendering loop |

### 1.5 Host API `PluginApi` {#_1-5-宿主-api-pluginapi}

The only interaction surface between plugin and host (host-constructed, stable):

| Group | Member | Stability |
| --- | --- | --- |
| Localization | `locale: string` (read-only), `t(key, params?)`, `onLocaleChange(listener): () => void` | Stable |
| Status/performance | `setStatus(PluginHostStatus)`, `reportGpuTime(ms)`, `reportDataScale(n)` | Stable |
| Notifications | `notify('info'\|'success'\|'warning'\|'error', message)` | Stable |
| Logging | `log(level: PluginLogLevel, message, details?)`—logged under the `plugin:<id>` scope and exported with run logs; fire-and-forget in the sandbox | Stable |
| Export | `exportFile(fileName, data: string \| ArrayBuffer \| Blob, mimeType?)` | Stable |
| Cache | `cache: PluginCacheApi` (see below) | Stable |
| Lifecycle | `reload?(): Promise<void>`—unload the current instance, rebuild from its factory and reactivate, for recovery from hangs (Worker killed, host capability absent) without a full-page refresh | Optional |
| GPU | `gpu?: GpuComputeApi`—present only when WebGPU is available; always `undefined` in a Worker sandbox; check for existence and fall back to CPU | Optional |
| Files | `openFile(): Promise<File \| null>`, `readText(file)`, `readBinary(file)` | Stable |
| Persistence | `getParam(key): unknown`, `setParam(key, value): void`—project-level, plugin-scoped | Stable (arrives as Promises in the sandbox; see warning below) |

`PluginHostStatus` (stable enum): `'ready' | 'computing' | 'paused' | 'loading' | 'saving' | 'error'`.
`PluginLogLevel` (stable enum): `'debug' | 'info' | 'warn' | 'error'`.

**Sandbox warning (part of the v1 contract)**: In an `isolated` sandbox, `getParam` / `setParam` / `cache.*` cross the RPC bridge and resolve as Promises (host signatures are synchronous). Plugins spanning contexts must always `await` them and must not rely on synchronous return values.

`PluginCacheApi` (stable; not persisted, released when the plugin unloads; default LRU limit 32 entries):
`get<T>(key): Promise<T | undefined>`, `set(key, value, ttlMs?): Promise<void>`, `delete(key): Promise<boolean>`, `clear(): Promise<void>`, `keys(): Promise<string[]>`—all asynchronous.

`GpuComputeApi` (stable; capability handle, plugins never touch raw GPU objects):

| Member | Signature |
| --- | --- |
| `available` | `readonly boolean` |
| `backend` | `readonly 'wasm' \| 'webgpu' \| 'none'` |
| `createBuffer` | `(size: number, usage: number, label?: string) => ComputeBufferHandle \| null` |
| `compileKernel` | `(descriptor: GpuKernelDescriptor) => GpuKernelHandle \| null` |
| `run` | `(kernel, buffers, x, y, z) => boolean` (buffer i → binding i; one dispatch + submit) |

`ComputeBufferHandle` (stable): `size` / `usage` (read-only), `write(data, offset?)`, `read(): Promise<ArrayBuffer>` (handles the MAP_READ readback buffer internally), `destroy()` (**must be called**, otherwise each compute leaks device memory).
`GpuKernelDescriptor` (stable): `label`, `wgsl`, `entryPoint?`, `workgroupSize?: [n,n,n]`, `bindings: Array<{ binding: number; bufferType: 'storage' | 'read-only-storage' | 'uniform' }>`.
`GpuKernelHandle` (stable): `label` (read-only), `compilationInfo(): Promise<string[]>`.

`ComputeProgress` (stable): `{ done: number; total: number; label?: string }`.
`ComputeResult` (stable): `{ ok: boolean; output?: unknown; metrics?: { gpuMs?: number; bytes?: number }; error?: string }`.

### 1.6 i18n conventions (stable) {#_1-6-i18n-约定-稳定}

- Locale codes use BCP-47-style strings; the host currently includes `'zh-CN'` and `'en-US'`. The key set is extensible (adding a locale is an extension, not a breaking change).
- Display text uses i18n dictionaries in three places: manifest `nameI18n` / `descriptionI18n`, parameter `labelI18n`, and toggle `on/offLabelI18n` (likewise `SelectOption.labelI18n`). Convention: plain `label` / `name` fields are fallbacks (English), overridden by `*I18n` by locale.
- Runtime text uses `api.t(key)` + `api.locale` + `api.onLocaleChange`; the host rebuilds the parameter panel when language changes.

### 1.7 Host-side observability records (read-only, shape frozen) {#_1-7-宿主侧可观测记录-只读-形状冻结}

The following types do not appear in the plugin implementation contract, but their shapes are frozen with v1 (run-log export, reproducibility locks, and other tools depend on them):

- `PluginInstallState`: `'installed' | 'loaded' | 'active'`.
- `PluginRegistryEntry`: registry record (id/name/version/author/description/icon/nameI18n/descriptionI18n/loaded/active/formats/plugin).
- `PluginRunRecord`: a single run record (`id`, `pluginId`, `pluginVersion?`, `kind: 'data-import' | 'compute' | 'custom'`, `label?`, `startedAt`, `endedAt?`, `durationMs?`, `ok?`, `error?`, `detail?`).
- `ParameterSnapshot` / `ParameterSnapshotEntry`: versioned parameter snapshots (`generatedAt` + `plugins: Record<id, { version, params }>`).

### 1.8 Outside the frozen scope {#_1-8-不在冻结范围内的事物}

The following are host implementation details or experimental areas, with no v1 stability commitment: internal `src/core/*` modules, RPC message wire format, behavioral details of the `new Function` fallback, marketplace catalog contents, and example data. Plugins should depend only on §1.1–§1.7.

---

## II. Compatibility commitments and deprecation policy {#二、兼容性承诺与弃用策略}

### 2.1 Commitments {#_2-1-承诺}

1. **No breaking changes within v1**: Frozen members are not removed, renamed, or changed in signature or semantics.
2. **New capabilities = extensions**: New manifest fields and lifecycle hooks are always optional (the host checks hooks with `?.`); new parameter-control types are added as members of the `ParamControlType` union. Old plugins behave unchanged on a new host.
3. **Forward-compatible reading**: `.cspkg` manifest validation requires only mandatory fields and rejects unknown `sandbox` enum values; other unknown fields are ignored. An old host can install a package with new optional fields (whose semantics do not depend on the old host).
4. **Contract continuity**: From the v1 freeze, the SDK contract has no breaking changes across 3 consecutive host major/minor versions (FR-22 rule).

### 2.2 Breaking changes and deprecation process {#_2-2-破坏性变更与弃用流程}

When a breaking change is truly necessary (permitted only in a **major** release, i.e. v1 → v2), the following process is mandatory:

| Stage | Action | Timing |
| --- | --- | --- |
| ① Deprecation notice | Mark the corresponding entry in this document **Deprecated (deprecated since vX)** and provide an alternative; add `@deprecated` JSDoc to the corresponding member in `src/types/plugin.ts`; announce in release notes/CHANGELOG. | Publish **at least one version** before removal. |
| ② Runtime warning | The host logs one `warn`-level message when a deprecated member is called (without changing behavior). | Starting in the same version as ① |
| ③ Retention period | Retain the deprecated member for at least one minor version, with behavior completely unchanged during that period. | — |
| ④ Removal | Remove only in the next major version; the migration guide ([migration.md](./migration)) must already provide a v(old)→v(new) comparison. | — |

**Version semantics**: The SDK contract version follows the host version's major number (v1 = the contract surface frozen during host 1.x). Minor versions only add, never change.

> This repository currently has no root CHANGELOG.md; deprecation announcements first appear in this document and docs-site navigation, and will also be recorded in a CHANGELOG when one is introduced.

---

## III. Signing and distribution (.cspkg) {#三、签名与分发-cspkg}

### 3.1 Package format {#_3-1-包格式}

A `.cspkg` is a ZIP archive (packed with fflate), with this minimal structure:

```
my-plugin.cspkg
├── manifest.json        # PluginManifest（含可选 signature 字段）
└── dist/
    └── index.js         # manifest.entry 指向的入口
```

**Entry semantics (frozen in v1)**: Entry source is a **function body**—the host executes it with `new Function('api', entrySource)`, the `api` parameter is `PluginApi`, and the body must `return` a `Plugin` object (including `manifest`). It is **not** an ESM module: do not use `import` / `export` syntax.

Hard limits (`src/core/cspkg.ts`, protecting against zip bombs and path traversal):

| Constraint | Value |
| --- | --- |
| Compressed archive size | ≤ 16 MiB |
| Total uncompressed size | ≤ 64 MiB (prechecked against the central directory; rejected without decompression) |
| File count | ≤ 512 |
| Required manifest fields | `id`, `entry`, `name`, `version` |
| `id` format | `^[a-z0-9][a-z0-9._-]{0,63}$` (case-insensitive) |
| `entry` path | Package-relative path; `..`, a leading `/`, or a drive-letter prefix are rejected; backslashes and a `./` prefix are normalized |
| `sandbox` | Only `'isolated'` / `'trusted'` (or omitted) |

### 3.2 Signing requirements (FR-05 pipeline) {#_3-2-签名要求-fr-05-管线}

- Algorithm: **ed25519**. Signature payload = UTF-8 bytes of `stableStringify(manifest without the signature field)` **concatenated** with the entry file's raw bytes. `stableStringify` is deterministic JSON with recursively sorted keys and no whitespace, ensuring byte-for-byte agreement between CLI and browser.
- Fingerprint = `ed25519:` + the first 16 bytes of SHA-256(public key) in hexadecimal (32 hex characters).
- The signature object is written back to `manifest.signature` (see §1.1), embedding the public key `pub` by default. During verification `pub` is cross-checked against `fingerprint` to prevent forgery that “claims a trusted fingerprint but embeds a different key.”

Signing CLI (Node ≥ 23.6, consistent with this repository's toolchain):

```bash
# 1) 生成密钥对（seed 保密，指纹公开给你的用户）
node scripts/sign-cspkg.mjs --genkey my-key.json

# 2) 签名一个包目录 → 产出 .cspkg（自动把 signature 写回 manifest.json 再打包）
node scripts/sign-cspkg.mjs ./package --key my-key.json --out my-plugin.cspkg --signer "Acme Lab"

# 3) 校验（可加 --trust 提供额外可信密钥文件）
node scripts/sign-cspkg.mjs --verify my-plugin.cspkg [--trust my-key.json]
```

### 3.3 Installation gate behavior {#_3-3-安装门禁行为}

At installation the host runs `verifyPackageSignature` (against built-in official keys + keys explicitly trusted by the user); the result determines the gate:

| Verification result `reason` | Meaning | Gate |
| --- | --- | --- |
| (`ok`) | Valid signature and trusted key | Install directly |
| `missing` | Unsigned | Show “trust this source” confirmation; install only after user confirmation |
| `untrusted-key` | Valid signature but unknown key | As above (ask the user to check the fingerprint with the publisher before adding a trusted key) |
| `malformed` | Invalid signature block structure | **Reject**, cannot bypass |
| `fingerprint-mismatch` | Embedded public key does not match claimed fingerprint | **Reject**, cannot bypass (treated as tampering) |
| `signature-invalid` | Signature does not match content | **Reject**, cannot bypass (modified after signing) |

Two invariants (v1 commitments): **signatures and sandboxing are independent**—a valid signature never relaxes execution isolation; **tampering can never be bypassed**—only `missing` / `untrusted-key` have a user-confirmation path.

### 3.4 Sandbox execution contexts {#_3-4-沙箱执行上下文}

- `isolated` (default): Entry runs inside a Web Worker, bridged by postMessage RPC (`src/core/sandbox.ts` / `plugin-worker.ts`); no host-page globals, DOM, or `window`; canvas uses a transferred OffscreenCanvas; `dom` / `three` handles are intentionally unavailable. If Workers are unavailable, it falls back to restricted `new Function` with an explicit warning (the fallback is **not** a security boundary).
- `trusted`: Executes directly in host context with full DOM capabilities, only for in-house packages.

---

## IV. Theme package (.cstheme) boundary {#四、主题包-cstheme-边界}

Theme packages and the plugin SDK are **two orthogonal mechanisms**: `.cstheme` is **pure declarative data** and never contains executable content—it cannot register lifecycle hooks, does not receive `PluginApi`, and does not pass through the §3 signing pipeline. The validator is `parseCsTheme()` in `src/core/theme-pack/schema.ts` (single entry point; any theme entering the app must pass through it first). Its rules are restated below:

**Structure**: Top level permits only `id`, `name`, `version`, `description?`, `author?`, `tokens`, `font?`, `density?`, `chartPalette?`, `minAppVersion?`; `tokens` has `common` / `light` / `dark` layers; `font` has only `family` / `scale` (scale ∈ [0.5, 2]); `density` ∈ `comfortable | compact`. **Any unknown key is rejected outright** (strict allowlists at every level).

**Security constraints** (the same defensive style as cspkg):

| Rule | Constraint |
| --- | --- |
| Dangerous prototype keys | Reject `__proto__` / `constructor` / `prototype` |
| Custom property names | Must match `--kebab-case` |
| Color keys | Keys containing `color` or prefixed with `--cat-` accept only hex / rgb() / rgba() / hsl() / hsla() literals |
| Dimension keys | `--font-size-*`, `--space-*`, `--radius-*`, `*-width`, `*-height` accept only px/rem/em/% lengths |
| Font stack | Allowlist sanitization: only alphanumerics, spaces, and `.-_`; unquoted family names must be generic keywords (`serif`, `sans-serif`, etc.) |
| Other values | Use a conservative character set and globally prohibit substrings: `url(`, `expression(`, `javascript:`, `data:`, `eval(`; strings must not contain characters such as `< > { } ; \` \` that can open new declarations/markup |

**Limits**: Whole JSON package ≤ 64 KiB; ≤ 64 tokens per layer; `chartPalette` 1–12 colors; name ≤ 80, description ≤ 500, author ≤ 100 characters; `id` follows plugin id rules; `version` / `minAppVersion` must be `major.minor.patch`.

**Evolution**: The `.cstheme` schema is also subject to the §2 extension rules—new token keys are added by extending the allowlist; themes are orthogonal to light/dark mode; `chartPalette` is advisory and defaults to the default palette when omitted.
