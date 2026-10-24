# 迁移指南：实验期 v0 → SDK v1

> **适用对象**：在 SDK 冻结（2026-09-12，宿主提交 `c7b7327`）之前编写的插件。
> **配套文档**：[v1 契约](./v1-contract)（冻结范围与兼容承诺的唯一转述）· [插件开发指南](../guide/plugins)（教程与示例）

实验期（v0，2026-08-13 初始提交 `f1aeeed` 起）契约经历了多次扩展。v1 冻结时做了两类整理：

1. **放宽约束**（v0 必需 → v1 可选、同步 → 可异步）——绝大多数 v0 插件**无需改动**即可在 v1 宿主上运行。
2. **新增能力**（沙箱、GPU、缓存、签名等）——按需采用，不采用不破坏。

没有**破坏性变更**：v0 中没有被删除或改名的成员。下面逐节对照。

## 目录

1. [逐版本演进时间线](#一逐版本演进时间线)
2. [生命周期：必需 → 可选](#二生命周期必需--可选)
3. [异步返回放宽](#三异步返回放宽)
4. [Scene3DHandle 类型具体化](#四scene3dhandle-类型具体化)
5. [新增成员一览](#五新增成员一览)
6. [迁移检查清单](#六迁移检查清单)

---

## 一、逐版本演进时间线

| 宿主提交 | 日期 | 契约变化 |
| --- | --- | --- |
| `f1aeeed` | 2026-08-13 | v0 初始契约：`PluginManifest` 基础字段、7 类参数控件、`Plugin` 生命周期（`destroy`/`activate`/`deactivate`/`updateParams` 为**必需**）、`Scene3DHandle` 字段为 `unknown` |
| `659c6b6` | 2026-08-14 | 新增 `manifest.sandbox`（`isolated`/`trusted`）与 `api.notify()`；3D 场景能力上线 |
| `761132d` | 2026-08-14 | 新增 `api.gpu`（`GpuComputeApi`、`ComputeBufferHandle`、`GpuKernelDescriptor`、`GpuKernelHandle`） |
| `dd49922` | 2026-08-16 | 新增第 8 类参数控件 `toggle`（含 `on/offLabelI18n`） |
| `b2e014c` | 2026-08-17 | 新增 `manifest.category`（`scientific`/`fun`/`utility` 市场分组） |
| `c7b7327` | 2026-09-12 | **v1 冻结**：新增 `api.log` / `api.cache` / `api.exportFile`、`manifest.signature`（FR-05）、`PluginRunRecord` / `ParameterSnapshot` 观测记录；`PluginRegistryEntry` 补 `nameI18n` / `descriptionI18n`；生命周期放宽（见下） |

---

## 二、生命周期：必需 → 可选

v0 中 `Plugin` 接口的四个成员是**必需**的，v1 将其降为可选（宿主以 `?.` 探测后调用）：

| 成员 | v0 | v1 | 迁移要点 |
| --- | --- | --- | --- |
| `destroy()` | 必需 | 可选 | 可以删除空实现；有资源释放逻辑的保留即可 |
| `activate(context)` | 必需 | 可选 | 同上。v1 里最小第三方包可以只实现 `render` |
| `deactivate()` | 必需 | 可选 | 同上 |
| `updateParams(params)` | 必需 | 可选 | 不消费参数回传的插件可删除 |

仍然**必需**的三件套不变：`manifest`、`init(api)`、`getParams()`。

> v0 插件带着这四个方法在 v1 宿主上运行完全正常——放宽只意味着「可以不写」，不意味着「不能写」。

## 三、异步返回放宽

| 成员 | v0 签名 | v1 签名 |
| --- | --- | --- |
| `getParams` | `() => ParamDefinition[]` | `() => ParamDefinition[] \| Promise<ParamDefinition[]>` |
| `getSupportedFormats` | `() => SupportedFormat[]` | `() => SupportedFormat[] \| Promise<SupportedFormat[]>` |

v0 的同步实现无需任何改动。v1 允许异步——例如参数表需要先 `await api.cache.get(...)` 预热时。

## 四、Scene3DHandle 类型具体化

v0 中 `Scene3DHandle` 的 `scene` / `camera` / `controls` / `renderer` 字段类型是 `unknown`，插件侧需要自行断言。v1 将其冻结为真实 Three.js 类型：

| 字段 | v0 | v1 |
| --- | --- | --- |
| `scene` | `unknown` | `three.Scene` |
| `camera` | `unknown` | `three.PerspectiveCamera` |
| `controls` | `unknown` | `three.OrbitControls` |
| `renderer` | `unknown` | `three.WebGLRenderer` |

迁移要点：

- 原先写 `const s = handle.scene as any` 的插件可去掉断言，直接获得类型检查。
- 断言成其他形状（如误当作 `THREE.Group` 的扩展类型）的代码在 v1 严格模式下可能报编译错——以 v1 类型为准修正。
- 注意 `three` 句柄**仅在声明了 `renderToScene` 时**由宿主挂载（`ContainerCapabilities.three` 是可选字段）；`isolated` 沙箱内 `three` / `dom` 有意不可用。

## 五、新增成员一览

以下成员在 v0 中不存在，v1 加入。全部为**可选**或**能力探测式**，v0 插件不感知它们也照常工作：

| 面 | 新增 | 采用建议 |
| --- | --- | --- |
| manifest | `sandbox`、`category`、`signature`（宿主注入）、`nameI18n` / `descriptionI18n`、`license` / `icon` / `homepage` / `dependencies` / `formats` | 第三方分发一律保持 `isolated`（缺省即安全）；市场展示补 `category` 与 i18n |
| 参数控件 | 第 8 类 `toggle` | 启停类布尔开关优先用 `toggle`（带 `on/offLabel`），普通布尔用 `checkbox` |
| PluginApi | `notify`、`log`、`cache`、`exportFile`、`gpu?`、`reload?` | 日志改用 `api.log` 而非 `console.*`（随运行日志导出、可复现）；`gpu` 必须判 `available` 并 CPU 回退 |
| 生命周期 | `compute`、`loadData`、`renderToScene`、`onProjectSave`、`onProjectLoad`、`reload?()` | 数据驱动插件实现 `loadData` + `getSupportedFormats`；需要项目持久化时机用 `onProjectSave/Load`；卡死恢复用 `reload()`（卸载→从工厂重建→重新激活） |
| 观测（宿主侧） | `PluginRunRecord`、`ParameterSnapshot`、`PluginInstallState`、`PluginRegistryEntry.nameI18n/descriptionI18n` | 只读消费，无需迁移 |

完整签名以 [v1 契约](./v1-contract) 为准。

## 六、迁移检查清单

逐项过一遍即可确认 v0 插件完全对齐 v1：

- [ ] **入口语义不变**：`.cspkg` 入口仍是**函数体**（宿主 `new Function('api', src)` 执行），必须 `return { manifest, init, getParams, ... }`——不是 ESM，不要写 `import` / `export`。若 v0 代码里有顶层 `export default`，改为显式 `return`。
- [ ] **沙箱内跨桥调用一律 `await`**：`isolated` 沙箱中 `getParam` / `setParam` / `cache.*` 跨 RPC 桥、以 Promise 解析（宿主签名为同步）。v0 若把 `api.getParam(key)` 的返回值直接用 `unknown` 消费，在沙箱里拿到的是 Promise——统一 `await`，两种沙箱下都正确。
- [ ] **`api.cache` 全异步**：`get/set/delete/clear/keys` 都返回 Promise，没有同步变体。
- [ ] **`api.gpu` 判空 + 判 `available`**：`isolated` 沙箱内恒为 `undefined`；即使 `trusted` 也仅在 WebGPU 设备可用时存在。始终写 CPU 回退分支。
- [ ] **GPU buffer 必须 `destroy()`**：`createBuffer` 得到的句柄用完即释放，否则每次 compute 泄漏设备内存直到设备销毁。
- [ ] **`renderToScene` 声明后才有 `container.three`**：未声明就不要访问；访问前判空。
- [ ] **可选生命周期可删**：空的 `destroy` / `activate` / `deactivate` / `updateParams` 实现可以移除，宿主不再强制要求。
- [ ] **分发路径二选一**：直接放 `trusted` 只适用于自研包；第三方包保持缺省 `isolated`。`.cspkg` 安装受门禁约束（大小/文件数/id/entry 路径），详见 [v1 契约 §3](./v1-contract#三签名与分发cspkg)。
- [ ] **签名按需附加**：v0 未签名包仍可安装（弹「信任此来源」确认）；要消除确认弹窗，用 `node scripts/sign-cspkg.mjs` 签名（Node ≥ 23.6）。
- [ ] **i18n 采用**：`name` / `label` 裸字段保留英文回退，中文文案放 `*I18n` 字典（`'zh-CN'` 键）。

完成以上检查后，v0 插件即为合格的 v1 包；无需重新学习任何 API——v1 只是把 v0 的实际行为规范化并冻结。
