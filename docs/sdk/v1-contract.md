# 插件 SDK v1 契约（FR-22）

> **状态**：v1 已冻结。自 Ergalics Studio 宿主版本 1.x 起，本文列出的 API 面享受兼容性承诺。
> **唯一事实来源**：`src/types/plugin.ts`（TypeScript 契约定义）。本文是对它的规范化转述；若两者出现出入，以 `src/types/plugin.ts` 为准并请向我们报告差异。
> **配套文档**：[迁移指南](./migration)（实验期 v0 → v1）· [插件开发指南](../guide/plugins)（教程与示例）· [官方脚手架模板](https://github.com/SnowLeopard-io/ErgalicsStudio/tree/main/templates/plugin-starter)

## 目录

1. [冻结范围清单](#一冻结范围清单)
2. [兼容性承诺与弃用策略](#二兼容性承诺与弃用策略)
3. [签名与分发（.cspkg）](#三签名与分发cspkg)
4. [主题包（.cstheme）边界](#四主题包cstheme边界)

---

## 一、冻结范围清单

以下类型与成员构成 **SDK v1 的稳定面**。标注含义：

- **稳定**：v1 内签名与语义冻结，宿主保证不破坏。
- **可选**：字段/方法可缺省，宿主以 `?.` 探测后调用；新增可选成员属于「扩展」，不算破坏。
- **宿主侧**：插件只读消费（由宿主构造），其形状同样冻结。

### 1.1 插件清单 `PluginManifest`

| 字段 | 类型 | 稳定性 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 稳定（必填） | 全局唯一 id。`.cspkg` 安装时按 `^[a-z0-9][a-z0-9._-]{0,63}$`（忽略大小写）校验 |
| `name` | `string` | 稳定（必填） | 显示名 |
| `version` | `string` | 稳定（必填） | 插件自身版本（semver 建议，宿主不强校验） |
| `author` | `string` | 稳定（必填） | 作者 |
| `description` | `string` | 稳定（必填） | 描述 |
| `entry` | `string` | 稳定（必填） | 入口描述符：内置插件为符号 id；`.cspkg` 为**包内相对路径**（绝对路径、盘符、`..` 被 `validateManifest` 拒绝） |
| `license` | `string?` | 可选 | SPDX 字符串 |
| `icon` | `string?` | 可选 | 图标 |
| `homepage` | `string?` | 可选 | 主页 |
| `dependencies` | `Record<string,string>?` | 可选 | 声明式依赖 |
| `formats` | `SupportedFormat[]?` | 可选 | 支持的数据格式（文件路由依据） |
| `category` | `'scientific' \| 'fun' \| 'utility'?` | 可选 | 市场分组 |
| `sandbox` | `'isolated' \| 'trusted'?` | 可选 | 执行上下文，缺省 `isolated`（Web Worker 沙箱）；`trusted` 仅用于自研包 |
| `nameI18n` | `Record<string,string>?` | 可选 | 按 locale 的显示名（见 1.6） |
| `descriptionI18n` | `Record<string,string>?` | 可选 | 按 locale 的描述 |
| `signature` | `PluginSignature?` | 可选（宿主注入） | `.cspkg` 的 ed25519 包签名（FR-05），缺省 = 未签名 |

`SupportedFormat`（稳定）：`extension: string`、`mimeTypes: string[]`、`magic?: number[]`（字节前缀）、`description?: string`。

`PluginSignature`（稳定，宿主与签名工具之间，插件不构造）：`alg: 'ed25519'`、`fingerprint: string`（`ed25519:<hex32>`）、`sig: string`（128 位十六进制）、`signer: string`、`signedAt: string`（ISO-8601）、`permissions?: string[]`、`pub?: string`（可选内嵌公钥，校验时与 fingerprint 交叉核对）。

### 1.2 生命周期 `Plugin`

插件模块的入口必须产出一个实现 `Plugin` 接口的对象。

| 成员 | 签名 | 稳定性 |
| --- | --- | --- |
| `manifest` | `readonly PluginManifest` | **稳定（必需）** |
| `init` | `(api: PluginApi) => Promise<void> \| void` | **稳定（必需）** |
| `getParams` | `() => ParamDefinition[] \| Promise<ParamDefinition[]>` | **稳定（必需）** |
| `destroy` | `() => Promise<void> \| void` | 可选 |
| `activate` | `(context: PluginRenderContext) => Promise<void> \| void` | 可选 |
| `deactivate` | `() => Promise<void> \| void` | 可选 |
| `render` | `(container: ContainerCapabilities) => Promise<void> \| void` | 可选 |
| `updateParams` | `(params: Record<string, unknown>) => Promise<void> \| void` | 可选 |
| `compute` | `(input: unknown, onProgress?: (p: ComputeProgress) => void) => Promise<ComputeResult>` | 可选 |
| `loadData` | `(file: File) => Promise<void> \| void` | 可选 |
| `getSupportedFormats` | `() => SupportedFormat[] \| Promise<SupportedFormat[]>` | 可选 |
| `renderToScene` | `(scene: Scene3DHandle) => Promise<void> \| void` | 可选（声明后宿主才挂载 Three.js 场景） |
| `onProjectSave` | `() => Promise<void> \| void` | 可选（项目持久化成功后触发，尽力而为） |
| `onProjectLoad` | `() => Promise<void> \| void` | 可选（项目状态恢复后触发，尽力而为） |

除 `manifest` / `init` / `getParams` 外全部可选——最小第三方包可以只实现 `render`。

`PluginRenderContext`（稳定）：`{ container: ContainerCapabilities; api: PluginApi }`。

### 1.3 参数 schema `ParamDefinition`

判别联合，共 **8 类控件**（`type` 为判别字段）。所有成员共享 `BaseParam`（稳定）：`key: string`、`label: string`、`labelI18n?: Record<string,string>`、`type: ParamControlType`、`hint?: string`。

| `type` | 专有字段 | 稳定性 |
| --- | --- | --- |
| `range` | `min` `max` `step` `value`（均 `number`） | 稳定 |
| `select` | `options: SelectOption[]`、`value: string`；`SelectOption = { value, label, labelI18n? }` | 稳定 |
| `number` | `min?` `max?` `step?`、`value: number` | 稳定 |
| `checkbox` | `value: boolean` | 稳定 |
| `text` | `value: string`、`placeholder?: string` | 稳定 |
| `file` | `accept: string`、`value: string \| null` | 稳定 |
| `button` | `variant?: 'primary' \| 'danger' \| 'default'`、`action?: string`（触发时经 `updateParams` 回传） | 稳定 |
| `toggle` | `value: boolean`、`offLabel?` `onLabel?`、`offLabelI18n?` `onLabelI18n?` | 稳定 |

宿主据此自动生成右侧响应式参数面板；用户编辑通过 `updateParams` 回送。

### 1.4 容器能力 `ContainerCapabilities` 与 `Scene3DHandle`

`ContainerCapabilities`（宿主侧，稳定）：

| 成员 | 类型 | 稳定性 |
| --- | --- | --- |
| `three` | `Scene3DHandle?` | 可选——仅当插件声明 `renderToScene` 时宿主挂载 |
| `canvas2d` | `HTMLCanvasElement?` | 可选——共享 2D 画布 |
| `dom` | `HTMLDivElement?` | 可选——通用 DOM 容器（`isolated` 沙箱内不可用） |
| `reportDataScale` | `(n: number) => void` | 稳定——向性能面板上报数据规模 |

`Scene3DHandle`（宿主托管 Three.js 场景的实时句柄，稳定）：

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `scene` | `three.Scene` | 根节点，添加网格/灯光 |
| `camera` | `three.PerspectiveCamera` | 宿主预置机位 |
| `controls` | `three.OrbitControls` | 轨道控制器（输入交互由宿主提供，插件无需写控制代码） |
| `renderer` | `three.WebGLRenderer` | 绑定宿主画布 |
| `setVisible(visible)` | `(boolean) => void` | 显隐 3D 表面（宿主在切换到非 3D 插件时自动隐藏） |
| `isVisible()` | `() => boolean` | 当前是否显示 |
| `render()` | `() => void` | 立即渲染一帧 |
| `snapshot()` | `() => string` | 当前帧 PNG data URL |
| `dispose()` | `() => void` | 释放 GPU 资源并停止渲染循环 |

### 1.5 宿主 API `PluginApi`

插件与宿主的唯一交互面（宿主侧构造，稳定）：

| 组 | 成员 | 稳定性 |
| --- | --- | --- |
| 本地化 | `locale: string`（只读）、`t(key, params?)`、`onLocaleChange(listener): () => void` | 稳定 |
| 状态/性能 | `setStatus(PluginHostStatus)`、`reportGpuTime(ms)`、`reportDataScale(n)` | 稳定 |
| 通知 | `notify('info'\|'success'\|'warning'\|'error', message)` | 稳定 |
| 日志 | `log(level: PluginLogLevel, message, details?)`——按 `plugin:<id>` 作用域记录，随运行日志导出；沙箱内为 fire-and-forget | 稳定 |
| 导出 | `exportFile(fileName, data: string \| ArrayBuffer \| Blob, mimeType?)` | 稳定 |
| 缓存 | `cache: PluginCacheApi`（见下） | 稳定 |
| 生命周期 | `reload?(): Promise<void>`——卸载当前实例、从工厂重建并重新激活，用于从卡死状态（Worker 被杀、宿主能力缺失）恢复而无需整页刷新 | 可选 |
| GPU | `gpu?: GpuComputeApi`——仅 WebGPU 可用时存在；Worker 沙箱内恒为 `undefined`，必须判空并 CPU 回退 | 可选 |
| 文件 | `openFile(): Promise<File \| null>`、`readText(file)`、`readBinary(file)` | 稳定 |
| 持久化 | `getParam(key): unknown`、`setParam(key, value): void`——项目级、插件作用域 | 稳定（沙箱内以 Promise 形式到达，见下方告诫） |

`PluginHostStatus`（稳定枚举）：`'ready' | 'computing' | 'paused' | 'loading' | 'saving' | 'error'`。
`PluginLogLevel`（稳定枚举）：`'debug' | 'info' | 'warn' | 'error'`。

**沙箱告诫（v1 契约的一部分）**：在 `isolated` 沙箱中 `getParam` / `setParam` / `cache.*` 跨 RPC 桥、以 Promise 解析（宿主签名为同步）。跨上下文插件一律 `await`，不要依赖同步返回值。

`PluginCacheApi`（稳定；不持久化，插件卸载即释放；LRU 上限默认 32 条）：
`get<T>(key): Promise<T | undefined>`、`set(key, value, ttlMs?): Promise<void>`、`delete(key): Promise<boolean>`、`clear(): Promise<void>`、`keys(): Promise<string[]>`——全部异步。

`GpuComputeApi`（稳定；能力句柄，插件永远不接触裸 GPU 对象）：

| 成员 | 签名 |
| --- | --- |
| `available` | `readonly boolean` |
| `backend` | `readonly 'wasm' \| 'webgpu' \| 'none'` |
| `createBuffer` | `(size: number, usage: number, label?: string) => ComputeBufferHandle \| null` |
| `compileKernel` | `(descriptor: GpuKernelDescriptor) => GpuKernelHandle \| null` |
| `run` | `(kernel, buffers, x, y, z) => boolean`（buffer i → binding i；一次 dispatch + submit） |

`ComputeBufferHandle`（稳定）：`size` / `usage`（只读）、`write(data, offset?)`、`read(): Promise<ArrayBuffer>`（内部处理 MAP_READ 回读缓冲）、`destroy()`（**必须调用**，否则每次 compute 泄漏设备内存）。
`GpuKernelDescriptor`（稳定）：`label`、`wgsl`、`entryPoint?`、`workgroupSize?: [n,n,n]`、`bindings: Array<{ binding: number; bufferType: 'storage' \| 'read-only-storage' \| 'uniform' }>`。
`GpuKernelHandle`（稳定）：`label`（只读）、`compilationInfo(): Promise<string[]>`。

`ComputeProgress`（稳定）：`{ done: number; total: number; label?: string }`。
`ComputeResult`（稳定）：`{ ok: boolean; output?: unknown; metrics?: { gpuMs?: number; bytes?: number }; error?: string }`。

### 1.6 i18n 约定（稳定）

- locale 代码使用 BCP-47 风格字符串，宿主当前内置 `'zh-CN'` 与 `'en-US'`；键集合可扩展（新增 locale 是扩展，不是破坏）。
- 显示文案三处走 i18n 字典：manifest 的 `nameI18n` / `descriptionI18n`、参数的 `labelI18n`、toggle 的 `on/offLabelI18n`（`SelectOption.labelI18n` 同理）。约定：`label` / `name` 等裸字段为回退值（英文），`*I18n` 按 locale 覆盖。
- 运行时文案走 `api.t(key)` + `api.locale` + `api.onLocaleChange`；语言切换时宿主重建参数面板。

### 1.7 宿主侧可观测记录（只读，形状冻结）

以下类型不出现在插件实现契约里，但其形状随 v1 冻结（运行日志导出、复现锁等工具依赖它们）：

- `PluginInstallState`：`'installed' | 'loaded' | 'active'`。
- `PluginRegistryEntry`：注册表记录（id/name/version/author/description/icon/nameI18n/descriptionI18n/loaded/active/formats/plugin）。
- `PluginRunRecord`：单次运行记录（`id`、`pluginId`、`pluginVersion?`、`kind: 'data-import' | 'compute' | 'custom'`、`label?`、`startedAt`、`endedAt?`、`durationMs?`、`ok?`、`error?`、`detail?`）。
- `ParameterSnapshot` / `ParameterSnapshotEntry`：带版本的参数快照（`generatedAt` + `plugins: Record<id, { version, params }>`）。

### 1.8 不在冻结范围内的事物

以下属于宿主实现细节或实验区，v1 不承诺稳定：`src/core/*` 内部模块、RPC 消息线格式、`new Function` 回退路径的行为细节、市场目录内容、示例数据。插件只应依赖 §1.1–§1.7。

---

## 二、兼容性承诺与弃用策略

### 2.1 承诺

1. **v1 内无破坏性变更**：已冻结成员不被删除、改名、改签名或改语义。
2. **新增能力 = 扩展**：新 manifest 字段一律可选；新生命周期钩子一律可选（宿主 `?.` 探测）；新参数控件类型作为 `ParamControlType` 联合的新成员加入。旧插件在新宿主上行为不变。
3. **向前兼容读取**：`.cspkg` 清单校验只要求必填字段并拒绝未知 `sandbox` 枚举值，其余未知字段被忽略——旧宿主可安装带新可选字段的包（新字段语义不依赖旧宿主）。
4. **契约连续性**：SDK 契约自 v1 冻结起连续 3 个宿主主/次版本无破坏性变更（FR-22 规则）。

### 2.2 破坏性变更与弃用流程

确需破坏性变更时（仅允许发生在 **major**，即 v1 → v2），必须遵循：

| 阶段 | 动作 | 时限 |
| --- | --- | --- |
| ① 弃用声明 | 在本文档对应条目标注 **Deprecated（vX 起弃用）**+ 替代写法；`src/types/plugin.ts` 对应成员加 `@deprecated` JSDoc；发布说明/CHANGELOG 同步公告 | 移除前**至少提前一个版本**发布 |
| ② 运行时告警 | 宿主对被弃用成员的调用输出一条 `warn` 级日志（不改变行为） | 与 ① 同版本起 |
| ③ 保留期 | 被弃用成员至少保留一个 minor 版本，期间行为完全不变 | — |
| ④ 移除 | 仅在下一个 major 移除；迁移指南（[migration.md](./migration)）必须已提供 v(旧)→v(新) 对照 | — |

**版本语义**：SDK 契约版本跟随宿主版本的主版本号（v1 = 宿主 1.x 期间冻结的契约面）。次版本只增不改。

> 本仓库当前没有根目录 CHANGELOG.md；弃用公告首发于本文档与文档站导航，未来引入 CHANGELOG 后同步登记。

---

## 三、签名与分发（.cspkg）

### 3.1 包格式

`.cspkg` 是一个 ZIP 归档（fflate 打包），最小结构：

```
my-plugin.cspkg
├── manifest.json        # PluginManifest（含可选 signature 字段）
└── dist/
    └── index.js         # manifest.entry 指向的入口
```

**入口语义（v1 冻结）**：入口源码是**函数体**——宿主以 `new Function('api', entrySource)` 执行它，`api` 形参即 `PluginApi`，函数体必须 `return` 一个 `Plugin` 对象（含 `manifest`）。它**不是** ESM 模块：不要使用 `import` / `export` 语法。

硬性限制（`src/core/cspkg.ts`，防 zip 炸弹与路径穿越）：

| 约束 | 值 |
| --- | --- |
| 压缩包大小 | ≤ 16 MiB |
| 解压后总大小 | ≤ 64 MiB（按中央目录预检，不解压即拒绝） |
| 文件数 | ≤ 512 |
| 必填 manifest 字段 | `id`、`entry`、`name`、`version` |
| `id` 格式 | `^[a-z0-9][a-z0-9._-]{0,63}$`（忽略大小写） |
| `entry` 路径 | 包内相对路径；`..`、`/` 开头、盘符开头一律拒绝；反斜杠与 `./` 前缀被归一化 |
| `sandbox` | 只允许 `'isolated'` / `'trusted'`（或缺省） |

### 3.2 签名要求（FR-05 管线）

- 算法 **ed25519**。签名载荷 = `stableStringify(manifest 去掉 signature 字段)` 的 UTF-8 字节 **拼接** 入口文件原始字节。`stableStringify` 为递归键排序、无空白的确定性 JSON，保证 CLI 与浏览器端逐字节一致。
- 指纹 = `ed25519:` + SHA-256(公钥) 前 16 字节的十六进制（32 个 hex 字符）。
- 签名对象写回 `manifest.signature`（见 §1.1），默认内嵌公钥 `pub`；校验时 `pub` 与 `fingerprint` 交叉核对，防止「声称可信指纹、内嵌另一把钥匙」的伪造。

签名 CLI（Node ≥ 23.6，与本仓库工具链一致）：

```bash
# 1) 生成密钥对（seed 保密，指纹公开给你的用户）
node scripts/sign-cspkg.mjs --genkey my-key.json

# 2) 签名一个包目录 → 产出 .cspkg（自动把 signature 写回 manifest.json 再打包）
node scripts/sign-cspkg.mjs ./package --key my-key.json --out my-plugin.cspkg --signer "Acme Lab"

# 3) 校验（可加 --trust 提供额外可信密钥文件）
node scripts/sign-cspkg.mjs --verify my-plugin.cspkg [--trust my-key.json]
```

### 3.3 安装门禁行为

宿主安装时执行 `verifyPackageSignature`（对照内置官方密钥 + 用户显式信任的密钥），结果决定门禁：

| 校验结果 `reason` | 含义 | 门禁 |
| --- | --- | --- |
| （`ok`） | 签名有效且密钥可信 | 直接安装 |
| `missing` | 未签名 | 弹出「信任此来源」确认，用户确认后方可安装 |
| `untrusted-key` | 签名有效但密钥未知 | 同上（提示用户与发布者核对指纹后添加可信密钥） |
| `malformed` | 签名块结构非法 | **拒绝**，不可绕过 |
| `fingerprint-mismatch` | 内嵌公钥与声称指纹不符 | **拒绝**，不可绕过（视为篡改） |
| `signature-invalid` | 签名与内容不匹配 | **拒绝**，不可绕过（签名后被修改） |

两条不变量（v1 承诺）：**签名与沙箱相互独立**——有效签名绝不放宽执行隔离；**篡改永不可绕过**——只有 `missing` / `untrusted-key` 存在用户确认路径。

### 3.4 沙箱执行上下文

- `isolated`（默认）：入口在 Web Worker 内运行，postMessage RPC 桥接（`src/core/sandbox.ts` / `plugin-worker.ts`）；无宿主页面全局、DOM、`window`；画布经转移的 OffscreenCanvas；`dom` / `three` 句柄有意不可用；Worker 不可用时回退到受限 `new Function` 并明确告警（回退**不是**安全边界）。
- `trusted`：宿主上下文直接执行，完整 DOM 能力，仅用于自研包。

---

## 四、主题包（.cstheme）边界

主题包与插件 SDK 是**正交的两套机制**：`.cstheme` 是**纯声明式数据**，永远不包含可执行内容——它不能注册生命周期、拿不到 `PluginApi`，也不经过 §3 的签名管线。校验器是 `src/core/theme-pack/schema.ts` 的 `parseCsTheme()`（单一入口，任何进入应用的主题必先通过它），其规则转述如下：

**结构**：顶层仅允许 `id`、`name`、`version`、`description?`、`author?`、`tokens`、`font?`、`density?`、`chartPalette?`、`minAppVersion?`；`tokens` 分 `common` / `light` / `dark` 三层；`font` 仅 `family` / `scale`（scale ∈ [0.5, 2]）；`density` ∈ `comfortable | compact`。**任何未知键直接拒绝**（逐层严格白名单）。

**安全约束**（与 cspkg 同一防御风格）：

- `__proto__` / `constructor` / `prototype` 危险键拒绝；
- 自定义属性名必须匹配 `--kebab-case`；
- 颜色类键（含 `color` 或 `--cat-` 前缀）只接受 hex / rgb() / rgba() / hsl() / hsla() 字面量；
- 尺寸类键（`--font-size-*`、`--space-*`、`--radius-*`、`*-width`、`*-height`）只接受 px/rem/em/% 长度；
- 字体栈白名单清洗：仅字母数字空格 `.-_`，未加引号的家族名必须是通用关键字（`serif`、`sans-serif` 等）；
- 其余值走保守字符集，且全局禁止子串：`url(`、`expression(`、`javascript:`、`data:`、`eval(`；字符串不得含 `< > { } ; \` \` 等可开新声明/标记的字符。

**限额**：整包 JSON ≤ 64 KiB；每层 ≤ 64 个 token；`chartPalette` 1–12 色；name ≤ 80、description ≤ 500、author ≤ 100 字符；`id` 同插件 id 规则；`version` / `minAppVersion` 必须 `major.minor.patch`。

**演进**：`.cstheme` 的 schema 同样适用 §2 的扩展规则——新增 token 键以白名单扩展方式加入；主题与明暗模式正交；`chartPalette` 为推荐性配置，缺省回退默认调色板。
