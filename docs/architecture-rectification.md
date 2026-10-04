# Ergalics Studio 架构权责整改文档

| 项目 | 内容 |
| --- | --- |
| 适用版本 | v1.9.0 |
| 性质 | 架构整改建议，基于 `src/` 全部相关源码逐文件核对 |
| 状态 | 待决断 |

## 1. 范围与方法

本文档依据 `src/` 下以下区域的源代码核对编写：

- `src/core/`（全部 40 个子模块与单文件）
- `src/plugins/`（`builtin/` 全部 70 个内置插件入口、`marketplace.ts`、`categories.ts`）
- `src/types/plugin.ts`（插件契约）
- `src/blocks/`、`src/editor/`、`src/chem/`（三个顶层引擎/领域目录）
- `docs/guide/architecture.md`（架构文档）
- `tests/` 目录结构、`package.json`

核对方式为逐文件检索 import 关系与重复定义，不做运行时验证。文档只陈述源码中可核实的事实与对应的整改动作。

## 2. 现状架构

按 `docs/guide/architecture.md` 的分层声明，系统分五层：React UI（`src/pages`、`src/components`）、State & Core Services（`src/stores`、`src/core`）、Block system（`src/blocks`，Flow 模式）、Editor（`src/editor`，Block/Code 模式）、Runtime（插件运行时与 Rust→WASM 原生核心 `native/`）。

实际依赖关系与文档声明存在以下出入：

- `src/core/` 中 6 个文件反向依赖 `@/blocks` 或 `@/editor`（见 3.2），文档未画这些边。
- `src/chem/`（物理化学核心）未在文档分层中出现，被 2 个 chem 插件直接 import（见 3.3）。

## 3. 问题与证据

### 3.1 通用框架能力位于插件目录

`src/plugins/builtin/shared/enhance.ts` 提供按钮参数工厂、通知、PNG/CSV 导出、空状态绘制。该文件被 `src/plugins/builtin/` 下 **70 个文件** import（`'./shared/enhance'` 或 `'../shared/enhance'`），覆盖全部内置插件。

同一功能在其他目录重复定义：

| 功能 | 定义位置 |
| --- | --- |
| `toCsv` | `src/plugins/builtin/shared/enhance.ts:136` |
| `toCsv` | `src/core/templates/data.ts:29` |
| `toCsv` | `src/pages/research/researchUi.ts:148` |
| `csvCell` | `src/plugins/builtin/shared/enhance.ts:125` |
| `csvCell` | `src/pages/research/researchUi.ts:142` |
| 空状态绘制 | `shared/enhance.ts:191`（`drawEmptyCanvas`） |
| 空状态绘制 | `src/plugins/builtin/geo/geoCore.ts:149`（`drawEmptyMessage`） |
| 空状态绘制 | `src/plugins/builtin/env/envCore.ts:931`（`drawEmptyMessage`） |

后果：框架级工具（导出、通知、按钮）不在 core 中，第三方 `.cspkg` 插件无法复用，只能随包复制。

### 3.2 核心层反向依赖业务层

`src/core/` 内 6 个文件 import `@/blocks` 或 `@/editor`：

| core 文件 | 依赖目标 |
| --- | --- |
| `src/core/plot/charts.ts` | `@/blocks/ops` |
| `src/core/pyodide/runtime.ts` | `@/blocks` |
| `src/core/bench/memory-bench.ts` | `@/blocks` |
| `src/core/bench/import-bench.ts` | `@/blocks` |
| `src/core/r/runtime-factory.ts` | `@/editor` |
| `src/core/r/builtin-ir-runtime.ts` | `@/editor` |

`src/blocks/`（DAG 编译、执行、注册）与 `src/editor/`（IR、代码生成、解释器）被 core 调用，二者实际承担核心引擎职责，但位于顶层目录。`docs/guide/architecture.md` 的分层图只画了 `core → 插件运行时` 的边，未画 core → blocks/editor 的边，文档与代码不一致。

### 3.3 领域核心库归属不明

`src/chem/`（元素周期表数据、CIF 解析、反应引擎、热力学模型）仅被两个插件 import：

- `src/plugins/builtin/chem-reaction/`（7 个文件：`reactmd/payload.ts`、`mols.ts`、`mech.ts`、`freelib.ts`、`figures.ts`、`dynamics3d.ts`、`catalog.ts`）
- `src/plugins/builtin/chem-crystal/`（5 个文件：`samples.ts`、`plugin.ts`、`parse.ts`、`crystal3d.ts`、`cellInfo.ts`）

该目录与 `src/core/` 平级，`src/core/` 不 import 它。它既不属于 core 子域，也不在插件目录内。

### 3.4 插件套件内部重复

`src/plugins/builtin/geo/geoCore.ts` 与 `src/plugins/builtin/env/envCore.ts` 各自定义功能相同的函数：

| 函数 | geoCore.ts | envCore.ts |
| --- | --- | --- |
| `isZh` | :157 | :17 |
| `parseDelimited` | :48 | :27 |
| `stripHeaderIfNonNumeric` | :60 | :38 |
| `drawEmptyMessage` | :149 | :931 |

`rampColor` 重名且签名不同：

| 位置 | 签名 |
| --- | --- |
| `src/plugins/builtin/env/envCore.ts:948` | `(t: number) => string`（CSS `rgb()` 字符串） |
| `src/core/pointcloud-gpu.ts:132` | `(t: number) => [number, number, number]` |

两个同名函数返回不同结构，调用方需按来源区分。

### 3.5 插件依赖机制未实现

`PluginManifest.dependencies?: Record<string, string>` 定义于 `src/types/plugin.ts:54`。全项目检索该字段的读取方，除 i18n 字典中的翻译字符串（`src/i18n/zh-CN.ts:202`、`src/i18n/en-US.ts:198`）外，无任何解析、校验或加载顺序逻辑。内置插件注册（`src/plugins/builtin/index.ts`）也不使用依赖信息。

### 3.6 出图路径双轨

- `src/core/plot/` 提供完整的 `DataTable → PlotSpec → SVG` 管线（`charts.ts`、`svg.ts`、`scale.ts`、`types.ts`），`src/core/figure/compose.ts` 提供多面板组图与导出。
- `src/plugins/builtin/scatter.ts` 等图表插件自行绘制 Canvas，不消费 core 的 PlotSpec 管线。
- `src/plugins/builtin/chem-reaction/figures.ts` 通过 `useFigureStore`（`src/stores/figureStore.ts`）把图挂到全局 figure 画布，并直接 import `PlotSpec`/`PlotSeries` 类型（`@/core/plot`）。

同一出图需求存在三条实现路径：core 管线、插件自绘 Canvas、插件挂 figureStore。

### 3.7 命名与导出不一致

| 位置 | 现象 |
| --- | --- |
| `src/plugins/builtin/particleManifest.ts` ↔ `particles.ts` | manifest 文件名与插件文件名不对称 |
| `src/plugins/builtin/pendulumManifest.ts` ↔ `doublePendulum.ts` | 同上 |
| `src/plugins/builtin/scatter.ts:16-17` | 同时 `export { scatterManifest }` 并 `import { scatterManifest }`，re-export 冗余 |

## 4. 排查排除项

以下区域经核对不存在权责问题，整改时不应改动：

| 区域 | 结论 |
| --- | --- |
| `src/core/wgsl.ts` | WGSL 内核集中于此，nbody/particles/wave/fluid 插件均从 `@/core/wgsl` import，无插件内重复定义 |
| `src/core/settings.ts` 与 `src/stores/settingsStore.ts` | core 管状态与持久化，store 仅做 zustand 封装，职责分离 |
| `src/core/ai/` 与 `src/plugins/builtin/ai-training/` | 前者仅被 `src/components/AiAssistantPanel.tsx` 消费；后者独立实现 TF.js 训练，二者无耦合 |
| `src/plugins/builtin/fluid-cfd-coupler/` 与 `em-eigensolver/` | 各自内嵌完整 `python/` 后端，互不引用，也无对 fluid/em 插件实例的运行时调用 |
| `tests/` | 按模块分目录（core/io/stats/plot/repro/…），与 `src/core` 子域一一对应 |
| `src/i18n/dicts/` | 字典按模块拆分，无重复键定义 |

## 5. 整改方案

三个方案按改动量递增。方案 A 无代码搬迁，方案 B 在 A 之后实施，方案 C 独立可选。

### 5.1 方案 A：立规矩（零代码搬迁）

1. 在 `docs/guide/architecture.md` 补充 core → blocks/editor 的实际依赖边，或明确 blocks/editor 归入 core 子域的迁移路径，消除文档与代码的分层矛盾。
2. 在 `CONTRIBUTING.md` 或 `docs/guide/plugins.md` 写入约定：内置插件之间禁止互相 import；共享能力一律经 `src/core/` 提供。
3. 删除 `src/pages/research/researchUi.ts` 与 `src/core/templates/data.ts` 中重复的 `toCsv`/`csvCell`，改为从单一位置导入。`researchUi.ts` 是页面层，应先验证其用法后调整。

### 5.2 方案 B：收敛搬迁（推荐）

将散落能力收敛到 `src/core/`，插件与页面统一改 import：

1. 新建 `src/core/plugin-tools/`，迁入 `shared/enhance.ts` 全部导出（`actionButton`、`actionFired`、`notify`、`dataUrlToBlob`、`canvasToPngBlob`、`exportCanvasPng`、`exportSnapshotPng`、`csvCell`、`toCsv`、`exportRowsCsv`、`drawEmptyCanvas`），更新 `src/plugins/builtin/` 下 70 个文件的 import 路径，删除 `src/plugins/builtin/shared/`。
2. 将 `geoCore.ts`、`envCore.ts` 的通用纯函数（`isZh`、`parseDelimited`、`stripHeaderIfNonNumeric`、`drawEmptyMessage`）收敛为一份，按各套件用法并入 `src/core/plugin-tools/` 或 `src/core/io/`，套件内改为引用。
3. 统一 `rampColor`：`core/pointcloud-gpu.ts:132` 返回 `[r,g,b]` 的版本保留为 `rampColor3` 语义，`envCore.ts` 返回 CSS 字符串的版本改为在 core 内由 `rampColor3` 派生，消除同名异签。
4. `src/chem/` 明确归属：迁入 `src/core/chem/` 并更新 chem-reaction、chem-crystal 的 import；或保留为独立包并写入架构文档分层。
5. 统一 manifest 命名：`particleManifest.ts`、`pendulumManifest.ts` 改名为与插件文件一致的 `particlesManifest.ts`、`doublePendulumManifest.ts`，删除 `scatter.ts` 的冗余 re-export（保留 `scatterManifest.ts` 为唯一出口）。

### 5.3 方案 C：实现依赖解析（可选）

在 `src/core/package/` 或插件加载流程（`src/stores/pluginStore.ts` 的 `load`）中消费 `PluginManifest.dependencies`：加载插件前解析依赖 id 列表，按拓扑序加载，未满足依赖时给出明确错误。该方案仅在需要支持第三方插件互相依赖时实施；当前 70 个内置插件无依赖声明，实施后不影响现有行为。

## 6. 迁移清单

方案 B 的逐文件动作：

| 动作 | 涉及文件 | 改动 | 受影响测试 |
| --- | --- | --- | --- |
| 迁出 enhance.ts | `src/plugins/builtin/shared/enhance.ts` 及 70 个 import 方 | 新建 `src/core/plugin-tools/`，全局替换 import | `tests/pluginEnhancements.*.test.ts`、`tests/builtinPlugins.test.ts` |
| 去重 toCsv/csvCell | `core/templates/data.ts`、`pages/research/researchUi.ts` | 删除重复定义，改 import | `tests/templates`、`tests/pages` |
| 合并 geoCore/envCore 通用函数 | 两个 `geoCore.ts`、`envCore.ts` 及各自套件 | 删除重复定义，改 import | `tests/geoPlugins.test.ts`、`tests/envPlugins.test.ts`、`tests/geoPhysicsPlugins.test.ts` |
| 统一 rampColor | `envCore.ts`、`core/pointcloud-gpu.ts` | 同名异签函数改为单一实现 | `tests/gpuCompute.test.ts`、`tests/envPlugins.test.ts` |
| 迁入 chem | `src/chem/` 全部文件、chem-reaction、chem-crystal | 路径迁移与 import 更新 | `tests/chemCrystal.test.ts`、`tests/chemReaction.test.ts` |
| 统一 manifest 命名 | 2 个 manifest 文件、`scatter.ts` | 重命名、删除 re-export | `tests/builtinPlugins.test.ts` |

## 7. 验收标准

1. `npm run typecheck` 与 `npm test` 全量通过。
2. `rg -n "shared/enhance" src/` 无结果（enhance 已迁出插件目录）。
3. `rg -n "function toCsv|function csvCell|function rampColor" src/` 各返回唯一定义。
4. `rg -n "from '@/blocks|from '@/editor|from '@/chem" src/core/` 无结果（core 不再反向依赖顶层业务目录），或 `docs/guide/architecture.md` 已同步实际依赖边。
5. 内置插件在插件面板中的加载、参数、导出行为与整改前一致（回归 `tests/builtinPlugins.test.ts` 等插件测试）。

## 8. 风险与回滚

- 搬迁 import 属于机械改动，主要风险是漏改引用导致构建失败；`typecheck` 能完整拦截。
- `src/core/plugin-tools/` 为新增目录，不改变现有运行行为，可通过单次 commit 回滚。
- `rampColor` 统一涉及 GPU 路径，改动后需重点回归 WebGPU 相关测试。
- 方案 C 若实施，需在加载流程中保证对无依赖声明的旧 `.cspkg` 包兼容（缺失 `dependencies` 字段时跳过解析）。
