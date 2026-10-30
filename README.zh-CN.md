<div align="center">

<img src="ico.ico" alt="Ergalics Studio logo" width="96" />

<h1>Ergalics Studio</h1>

<p><b>浏览器中的科学计算工作站</b>——交互式数据探索、GPU 计算调度与沙箱化插件系统，全部在浏览器中运行。</p>

<p>
<a href="https://snowleopard-io.github.io/ErgalicsStudio/"><img alt="官方网站" src="https://img.shields.io/badge/%E5%AE%98%E6%96%B9%E7%BD%91%E7%AB%99-0891b2?style=for-the-badge" /></a>
<a href="https://snowleopard-io.github.io/ErgalicsStudio/app/"><img alt="打开在线工作站" src="https://img.shields.io/badge/%E6%89%93%E5%BC%80%E5%9C%A8%E7%BA%BF%E5%B7%A5%E4%BD%9C%E7%AB%99-16a34a?style=for-the-badge" /></a>
<a href="https://snowleopard-io.github.io/ErgalicsStudio/app/docs/"><img alt="文档站点" src="https://img.shields.io/badge/%E6%96%87%E6%A1%A3%E7%AB%99%E7%82%B9-8b5cf6?style=for-the-badge" /></a>
</p>

<p>
<a href="https://github.com/SnowLeopard-io/ErgalicsStudio"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-SnowLeopard--io%2FErgalicsStudio-181717?logo=github&logoColor=white&style=flat-square" /></a>
<a href="https://gitee.com/cnt-code/ergalics-studio"><img alt="Gitee" src="https://img.shields.io/badge/Gitee-cnt--code%2Fergalics--studio-c71d23?logo=gitee&logoColor=white&style=flat-square" /></a>
<a href="LICENSE"><img alt="许可证" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" /></a>
<a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript&logoColor=white&style=flat-square" /></a>
<a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white&style=flat-square" /></a>
<a href="#gpu-计算与原生核心"><img alt="WebGPU" src="https://img.shields.io/badge/WebGPU-WGSL-8b5cf6?style=flat-square" /></a>
<a href="#gpu-计算与原生核心"><img alt="WASM" src="https://img.shields.io/badge/WASM-Rust-000000?logo=rust&logoColor=white&style=flat-square" /></a>
</p>

</div>

<br>

![Ergalics Studio — 标准模式（拖入 → 即可见）](docs/assets/screenshots/platform/mode-standard-welcome.png)

---

## 目录

- [概览](#概览)
- [特性](#特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [架构](#架构)
- [项目结构](#项目结构)
- [四种工作模式](#四种工作模式)
- [科研模块](#科研模块)
- [版本控制](#版本控制git-仓库化项目)
- [插件系统](#插件系统)
- [GPU 计算与原生核心](#gpu-计算与原生核心)
- [测试](#测试)
- [文档](#文档)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可证](#许可证)

---

## 概览

Ergalics Studio 是完全运行于浏览器中的科学计算工作站：React + TypeScript 前端、WebGPU 计算管线，以及为第三方扩展设计的插件架构。工作台以四种模式为不同用户提供入口：

| 模式 | 适合谁 | 你做什么 |
| ---- | ------ | -------- |
| **标准（Standard）** | "我有数据 → 我看到结果" | 将数据集拖入插件即可看到可视化——最快路径。 |
| **流程（Flow）** | 管线搭建者 | 从内置区块组合出可视化数据流管线，按拓扑顺序运行并逐节点检查输出。 |
| **积木（Block）** | 学习者 / 喜欢命令式手感的人 | 类 Scratch 的积木编辑器，单个"运行"帽子区块启动程序；完全可脚本化。 |
| **代码（Code）** | 真正的脚本编写 | Monaco 编辑器支持 Python / R / JavaScript，切换语言时整份代码经共享 IR 即时互译。 |

项目处于**积极开发**且已可端到端使用。已交付（详见下文各节）：

| 领域 | 今日已交付 |
| ---- | ---------- |
| 工作台 | 四种模式、工作台文件资源管理器 + 标签页中央区 + 按文件类型分派的编辑器（Code / Flow / Block）、**158 个内置插件（148 个科学插件自动加载 + 10 个趣味工具手动加载），按 19 个学科分组**、沙箱化插件系统 + 市场目录、cspkg 签名门禁 |
| 计算 | 实时 WebGPU 计算（14 个可复用 WGSL 内核）、浏览器内 AI 训练插件、AI 助手（离线规则引擎 / 在线 OpenAI 兼容服务） |
| 数据与绘图 | 科研二进制数据导入（HDF5 / NetCDF / FITS / Zarr / Parquet）、出版级 SVG/PDF 绘图、统计分析、可复现性支持、189 个示例数据集 + 11 个示例工程 |
| 代码编辑 | Python 经 Pyodide；R/JS 经共享 IR 引擎，R 存在内置 webR 分发包时升级为完整自由运行时；三语言往返由测试固化 |
| 科研 | **26 个独立科研工具，分 6 组**（可内嵌到工作台画布）、科研级插件元数据 + 统一科学输出栏、单位系统与分块读取配套内核 |
| 版本控制 | Git 仓库化项目（浏览器端 isomorphic-git + LightningFS）、侧边栏 Git 面板与规范提交历史 |
| Web 界面 | 官方网站（画廊 / 主题市场 / 插件市场）、工作台与文档站点，统一合并部署、深链互通 |

---

## 特性

**渲染与工作台**

| 能力 | 说明 |
| --- | --- |
| 工作台外壳 | 顶栏（项目切换 / 模式切换 / 科研启动器）、活动栏、多视图侧栏（文件 / Git / 插件，可调宽可收起）、标签页式中央视口、右侧参数面板、带 GPU/性能指示器的状态栏。 |
| 文件资源管理器与标签页 | 项目文件树（含文件操作）+ 文件信息面板；中央区以标签页承载插件画布、文件预览（文本 / Markdown / 图片 / PDF / 音频 / 视频）、文件编辑器、内嵌科研工具与设置页。 |
| 文件编辑器 | `.py` / `.js` / `.r` 用 Monaco 编辑器打开，`*.flow.json` 用流程 DAG 编辑器打开，`*.block.json` 用 Blockly 编辑器打开，均带脏状态与写回工作区的保存；**在模式中打开**桥接可把任意缓冲推入对应完整工作台模式。 |
| 项目生命周期 | 创建 / 打开 / 保存 / 自动保存 / 分享（`.clproj` 存于 IndexedDB）。 |
| 文件路由 | 按魔数 + 扩展名把拖入文件路由到匹配插件，多匹配时弹出选择，同名文件替换时先确认；分隔文本解析跳过 `#` 注释行，格式白名单含 `.xy` / `.xye`。 |
| 中央导出菜单 | 把当前插件画布下载为 PNG（默认约 600 dpi，可选透明底）或保存进项目 `figures/` 工作区目录；3D 插件还可将整个场景导出为 **GLB / STL**（下载，或保存进 `data/` 工作区）；各插件的 CSV 导出按钮保留在参数面板中。 |
| 2D 与 3D 视口 | 2D canvas 容器（点云 / 时间序列 / 直方图 / 热力图 / 等值线 / 散点 / 柱状 / 雷达 / 网络 / 气泡 / 小提琴 / 桑基 / 箱线 / 平行坐标 / 误差带 / 矩形树 / QQ 图等）+ 宿主管理的 Three.js 3D 场景（按需懒创建、插件间干净清理；ACES 电影级色调映射 + IBL 环境光照）。 |
| 3D 模型查看器 | GLB / GLTF / STL / OBJ / PLY 导入（Draco 与 meshopt 解码）；着色 / 线框 / 法线 / X-ray 观察模式、剖面、glTF 动画回放、两点测距与视角预设；任意 3D 场景可经中央导出菜单导出为 GLB / STL。 |
| 命令面板与引导教程 | 全局命令面板（**Ctrl/Cmd+K**）可跳转工具、插件与文件并执行动作；快捷键帮助对话框；工作台与项目模板的首次使用引导教程。 |

**插件系统**

| 能力 | 说明 |
| --- | --- |
| **158 个内置插件** | （148 个科学插件自动加载 + 10 个趣味工具手动加载），覆盖完整 API 面；两级加载，侧边栏按 **19 个学科**分组（图表 / 数学与统计 / 物理 / 化学 / 生物 / 医学与公共卫生 / 地理 / 环境 / 天文 / 材料学 / 工程仿真 / 经济与金融 / 心理与行为 / 社会科学 / 数据与智能 / 计算机科学 / 特效渲染 / 音乐与艺术科学 / 趣味工具）。 |
| 市场目录 | `src/plugins/marketplace.ts`（精选标签 / 流行度 / 分类筛选）。 |
| `.cspkg` 包加载 | 清单校验 + **Worker 优先隔离**（§沙箱）：第三方入口经 postMessage 桥接与 OffscreenCanvas 渲染，回退为受限制作用域的 `new Function`（非安全边界）；两者均受 Ed25519 签名门禁约束（FR-05，见 `SECURITY.md`）。 |
| 本地化参数面板 | 插件参数面板内置 CSV 导出按钮、分析叠加层（趋势线、累积/密度直方图、均值标记、抖动点、排序）；全部科研级插件带发送至 Figure Studio 动作。 |

**科研级插件**

- `PluginManifest.research` 元数据契约（`src/types/plugin.ts`）：科研就绪分级（`research` 研究级 / `quasi-research` 准研究级 / `demonstration` 演示级 / `educational` 教学演示），并声明物理量单位、内置验证基准 id、可复现标记与适用范围说明——在市场与详情面板以语义色徽章呈现（中英双语）。
- 统一科学输出总线 `src/core/research/scienceOutput.ts` 与视口下方的 `ScienceOutputStrip` 输出栏：插件发布结构化结论（R²、RMSE、LOOCV、置信区间、收敛 / 守恒诊断），让每张图都附带其数值结论。

**版本控制**

| 能力 | 说明 |
| --- | --- |
| Git 仓库化项目 | `src/core/git/` 以单一 `GitAdapter` 接口提供浏览器端实现（isomorphic-git + LightningFS，IndexedDB 工作区）与 Node 端实现（运行时加载 simple-git，不可用时回退 isomorphic-git），覆盖 init / status / log / diff / add / commit / checkout / branch / merge / remote / hooks，外加文件级写入 / 删除 / 重命名 / 目录列举与仓库 config。 |
| 工作区 VFS | 文件统一走轻量 `Vfs` 抽象（`src/core/vfs/`）：浏览器端为 LightningFS（IndexedDB），Node/测试端为内存实现；Git 工作区与文件资源管理器共享同一份文件系统。 |
| 项目↔仓库同步 | `projectStore` 将保存快照镜像到仓库工作区（`project.clproj`），并驱动侧边栏 **Git 面板**（分支 + 领先/落后、一键提交框（暂存全部待提交变更）+ 规范提交信息、近期提交日志、分支 / 克隆 / pull / push / fetch（可配置 CORS 代理）、运行与图像的自动提交）。 |

**基础设施**

- i18n（zh-CN / en-US）、暗 / 亮主题、性能监控（FPS / GPU / 内存 / 数据规模）。
- 研究级可靠性内核：结构化错误分类法 + `Result`/重试 + 错误注册表、可组合校验框架与安全解析、Pandera 风格数据质量引擎（期望 / 画像 / 坏行隔离），见 `src/core/errors|validation|data-quality`。

**科学计算与科研模块（纯 TS 核心 + Zustand store + 独立整页）**

| 内核 | 位置 | 范围 |
| --- | --- | --- |
| 统计内核 | `src/core/stats/` | 描述统计、特殊函数、假设检验、效应量、多重比较校正、功效分析。 |
| 科研二进制 I/O | `src/core/io/` | HDF5 / NetCDF / FITS / Parquet / Zarr 单一调度器。 |
| 出版级绘图引擎 | `src/core/plot/` | SVG + PDF 导出。 |
| 可复现性内核 | `src/core/repro/` | 带种子随机数、稳定哈希、运行清单、DAG→Python 导出；配套 `repro.lock`。 |
| 数据质量引擎与单位系统 | `src/core/data-quality/` · `src/core/units/` | 数据质量引擎；类型化单位系统。 |

---

## 技术栈

| 层级    | 选型                                                       |
| ------- | --------------------------------------------------------- |
| UI      | React 18, react-router-dom 7, Zustand 5                   |
| 语言    | TypeScript 5.7 (strict)                                   |
| 构建    | Vite 6                                                     |
| 3D      | Three.js r185 (+ @types/three)，GLTF / STL / OBJ / PLY 加载器与 Draco、meshopt 解码 |
| 原生    | Rust crate `native/ergalics-core`（源码交付；发行构建使用生成的 WASM stub） |
| GPU     | WebGPU / WGSL via web-sys                                  |
| SQL     | DuckDB-WASM（懒加载）+ Apache Arrow                        |
| 版本控制 | isomorphic-git 1 + LightningFS（浏览器）· simple-git（Node，回退 isomorphic-git） |
| 测试    | Vitest (单元) + Playwright-core (E2E, headless Edge)       |
| 文档    | VitePress (独立的 `docs/` workspace)                       |
| 打包    | fflate (cspkg ZIP), lz-string (项目压缩)                   |

---

## 快速开始

前置要求：**Node.js ≥ 20** 与 npm。**Rust 工具链**（`wasm32-unknown-unknown` target + `wasm-bindgen-cli`）为可选——`npm run build:web` 会注入生成的 WASM stub，运行时全部计算走浏览器原生 WebGPU/CPU 路径。

```bash
npm install         # 安装依赖
npm run dev         # 开发运行（欢迎页先做硬件自检：WebGPU/WASM/IndexedDB）

npm run build       # wasm → 类型检查 → vite build → 文档
npm run build:web   # 仅前端（生成 WASM stub，无需 Rust）
npm run build:wasm  # 编译 Rust 核心（需要 Rust 工具链）

cd docs && npm install && npm run dev   # 文档站点
```

生产构建产物输出到 `dist/`。

---

## 架构

```mermaid
flowchart TB
    subgraph UI["React UI (src/pages · src/components/blocks)"]
        A1["欢迎 · 工作台<br/>(顶栏/活动栏/侧栏/中央/右侧/状态)"]
        A2["设置 · 分享 ·<br/>插件对话框 · 示例数据对话框"]
        A3["流程模式画布<br/>调色板 · 画布 · 节点 · 参数编辑器<br/>工具栏 · 结果预览"]
    end

    subgraph State["状态与核心服务"]
        B1["Zustand stores<br/>app / project / plugin / settings / block<br/>figure / notebook / lineage / 命令面板 / …"]
        B2["核心服务<br/>storage (IndexedDB) · events (bus)<br/>i18n · theming · perf<br/>fileFormat · wasm · gpu<br/>scene3d · sandbox<br/>vfs (工作区文件) · git<br/>research/scienceOutput"]
    end

    subgraph Blocks["区块系统 (流程模式, src/blocks)"]
        D1["目录（57 个区块）<br/>data_source · transform · filter<br/>math · statistics · units · visualize · plot"]
        D2["编译器<br/>纯函数 · 校验端口/类型<br/>拓扑排序 · 诊断"]
        D3["执行器<br/>增量缓存<br/>脏值传播 · run()"]
        D4["渲染桥接<br/>viz.* RenderedView → plugin.loadData<br/>(无副作用的执行器)"]
    end

    subgraph Runtime["运行时层"]
        C1["插件运行时<br/>builtin/* (148 科学 + 10 趣味)<br/>市场目录<br/>cspkg 加载器 (沙箱)<br/>注册表与生命周期"]
        C2["GPU 计算<br/>gpu.ts 适配器/设备<br/>compute.ts PluginApi.gpu<br/>14 个 WGSL 内核 (wgsl.ts)<br/>CPU 回退"]
    end

    UI --> B1
    UI --> B2
    B1 <--> B2
    B1 --> C1
    B2 --> C1
    B2 --> C2
    A3 --> B1
    B1 --> D2
    B1 --> D3
    D2 --> D3
    D1 --> D2
    D3 --> D4
    D4 --> C1
```

- **宿主 ↔ 插件契约**：每个插件实现 `Plugin` 接口（init/destroy/activate/…/renderToScene）并接收 `PluginApi`；沙箱化插件仅通过类型化 RPC 协议通信（`src/core/sandbox.ts` + `plugin-worker.ts`）。
- **WebGPU**：`src/core/gpu.ts` 管理适配器/设备并带 CPU 回退；`src/core/compute.ts` 暴露面向插件的计算面（`PluginApi.gpu`）。

---

## 项目结构

```
.
├── src/                      # 前端
│   ├── core/                 #   47 个子目录 + 39 个根级模块: storage, events, compute,
│   │                         #   gpu, wasm, fileFormat, scene3d, sandbox, cspkg, errors,
│   │                         #   validation, data-quality, stats, io (HDF5/NetCDF/FITS/Zarr/Parquet),
│   │                         #   plot, repro, uncertainty, units, experiment, lineage,
│   │                         #   chunked, figure, notebook, package, model, signal, sweep,
│   │                         #   profiler, sql, report, inference, logger, vfs (工作区文件系统),
│   │                         #   git (版本控制), research (科学输出)
│   ├── blocks/               #   区块系统 (流程模式): registry · compiler · executor ·
│   │                         #     ops · catalog (57 个区块) · sample · l10n · render · context · fileData
│   ├── editor/               #   积木与代码模式: ir · block (Blockly) · code · codegen ·
│   │                         #     runtime (StudioApi + interpreter)
│   ├── components/           #   流程画布 / 积木与代码画布 / 工作台外壳 /
│   │                         #     editor/fileEditors (按文件分派的 Code·Flow·Block 编辑器)
│   ├── pages/                #   欢迎、工作台（文件资源管理器 · 标签页中央区）、设置、分享、
│   │                         #     插件视图，以及科研工具（单一注册表
│   │                         #     src/pages/research/toolRegistry.ts —
│   │                         #     measure · model · data · signal · deliver · utils 六组）
│   ├── plugins/builtin/      #   158 个插件：148 个科学插件自动加载 + 10 个趣味工具 (2D + 3D)
│   ├── plugins/marketplace.ts#   市场目录
│   ├── stores/               #   zustand stores
│   ├── types/                #   插件 & 项目 & 编辑器契约
│   └── native/               #   生成的 WASM 绑定 (git 未跟踪)
├── native/ergalics-core/     # Rust 核心，源码交付 (device, compute, utils)
├── examples/{data,projects,code}/  # 189 个示例数据、11 个 `.clproj` 工程、9 个 Python 程序
├── scripts/ · tests/ · docs/ · website/ · bench/ · templates/ (plugin-starter)
```

---

## 四种工作模式

**标准模式**——默认落地体验：顶栏（含项目切换下拉）、活动栏 + 多视图侧栏（文件 / Git / 插件）、标签页式中央视口、右侧参数面板。拖入文件即按扩展名 + 魔数路由到匹配插件；多匹配时由选择对话框决定。适合"已知要哪个插件、只差一个文件"的场景。

![标准模式 — 拖入文件，即可看到可视化](docs/assets/screenshots/platform/mode-standard-welcome.png)

**流程模式**——从 **57 个内置区块**（data_source / transform / filter / math / statistics / units / visualize / plot）**组合可视化数据流管线**并运行。左侧调色板、中间画布（节点 + 边）、右侧节点参数编辑器、底部按输出类型自适应的实时结果预览（`RenderedView` 经插件渲染器 / `DataTable` 只读表 / `Scalar` 内联）。编译器是纯函数（端口 / 类型校验 + 环检测 + Kahn 拓扑排序）；执行器带增量缓存与脏值传播，改单个区块只重跑自身及其下游。图以 `*.flow.json` 工作区文件保存（`{version, kind:'ergalics-flow', graph}`），可在文件资源管理器的流程编辑器中打开；旧的项目 `blockGraph` 状态仍可读取。架构详见 [`docs/guide/flow-mode.md`](docs/guide/flow-mode.md)。

![流程模式 — 示例管线（Normalize → Histogram / Scatter / Summary）](docs/assets/screenshots/platform/mode-flow.png)

**积木模式**——类 Scratch 编辑器，单个「运行 / Run」帽子区块是唯一执行入口。区块 JSON ↔ **共享 IR**（`src/editor/ir/`）双向往返；IR 解释器调用与流程模式区块相同的 `studio.*` API，因此 `studio.plot(...)` 落到同一个散点图插件；IR → JS/Python 代码生成实时可见。Blockly 13 提供画布并**懒加载**（~828 KB 按需 chunk），i18n 经 `BKY_*` 键接入。含 40 个区块与 5 个示例程序，详见 [`docs/guide/block-mode.md`](docs/guide/block-mode.md)。

![积木模式 — "运行"帽子区块启动程序，加载遥测、归一化并绘图](docs/assets/screenshots/platform/mode-block.png)

**代码模式**——真正脚本的 Monaco 编辑器，分段的 **Python / R / JS** 切换器 + 引擎徽章。**Python** 经 Pyodide Web Worker 运行完整 CPython（`studio` 作为可导入模块注入，REPL 单条求值，停止即重启 worker）。**R / JavaScript** 解析为共享 IR，在积木模式同一解释器上执行；R 优先升级到内置完整 webR 运行时，缺失时回退 IR 引擎。切换语言时打开**悬浮预览窗**——Monaco 编辑器展示可编辑的参考翻译——仅在显式**应用**后才替换缓冲，另提供**放弃并清空**与**取消**选项，配 `forceBlank` 守卫保护刚清空的缓冲，并支持一键撤销。三模式经同一份 IR 无缝互转（`src/editor/flow/convert.ts` + `src/editor/block/convert.ts` + `code/parse.ts` + `mergeFlowIR` 合并写回 + 图签名守卫防丢节点），该往返由 `tests/editor/roundtrip-all-langs.test.ts` 固化。含 9 个示例程序，详见 [`docs/guide/block-mode.md`](docs/guide/block-mode.md)。

![代码模式 — 支持 Python/R/JavaScript 的 Monaco 编辑器（Python 经 Pyodide）](docs/assets/screenshots/platform/mode-code.png)

---

## 科研模块

全部 26 个科研工具收录在单一注册表（`src/pages/research/toolRegistry.ts`）中，共享 **ToolShell** 统一布局。规范路由为 `/studio/<toolId>`（旧 `/#/<id>` 哈希路由保留为重定向）；每个工具也可经 `openToolEmbedded` **内嵌为标准模式中央画布的一个标签页**。`requireProject` 的工具在未打开项目时显示 `EmptyProject` 占位。每个模块都遵循"纯 TS 核心（无 React）→ Zustand store → 页面，单元测试覆盖"的分层：

| 分组 | 页面 | 路由 | 功能 |
| ---- | ---- | ---- | ---- |
| measure | 不确定性 | `/studio/uncertainty` | bootstrap 置信区间、蒙特卡洛传播、MCMC——CPU 或 WGSL GPU 引擎，R-hat / ESS |
| measure | 数据画像 | `/studio/profiler` | 流式列画像、相关矩阵、质量评分 + 问题清单 |
| model | 模型实验室 | `/studio/model-lab` | OLS / 逻辑 / 岭 / 多项式回归 + 系数表与残差诊断 |
| model | Inference Forge | `/studio/inference` | HMC / NUTS 贝叶斯推断 + WAIC / LOO / PPC + 轨迹与密度图 |
| model | 模型推理 | `/studio/model-inference` | 浏览器内用 WebGPU 运行 ONNX 模型 |
| model | 参数扫描 | `/studio/sweeps` | 网格 / 列表 / 拉丁超立方参数批量实验，响应面可视化（需项目） |
| data | SQL 工作台 | `/studio/sql` | DuckDB-WASM 查询项目文件：join / 聚合 / 窗口函数，结果自动接入血缘（需项目） |
| data | 数据血缘 | `/studio/lineage` | 由运行记录 + 数据导入重建的文件→运行 DAG（SVG 画布） |
| data | Figure Studio | `/studio/figures` | 在 IEEE / Elsevier 模板上组合多面板出版级图表，SVG / PDF / PNG-600dpi 导出（需项目） |
| data | 分析 | `/studio/analysis` | 快速图表 + 描述统计 + t / Mann–Whitney 检验（不在欢迎页网格展示） |
| data | 数据清洗向导 | `/studio/cleaning` | 分步向导：类型转换、缺失值策略、异常值标记、去重、重命名（需项目） |
| data | 工作区文件 | `/studio/files` | 面向 VFS 的工作区文件浏览器：按目录懒加载的文件树、文本预览、下载（需项目） |
| signal | 信号实验室 | `/studio/signal` | FFT / Welch PSD、窗函数、Savitzky–Golay / 移动平均滤波、ACF/PACF、季节分解（需项目） |
| signal | Notebook | `/studio/notebook` | 项目内 Markdown + Python 混合单元格，运行于专用 Pyodide（需项目） |
| signal | 实验记录 | `/studio/runs` | 自动记录运行历史（来源/参数/指标/耗时），参数 A/B 对比 |
| deliver | 报告生成器 | `/studio/report` | 叙述 + 图表 + 表格 + 交互筛选器 → 单个自包含 HTML（需项目） |
| deliver | 可复现锁 | `/studio/reprolock` | `repro.lock` 导出 / 导入 + 漂移校验与一键复现 |
| deliver | 补充材料打包 | `/studio/supplement` | 论文随附 ZIP（`manifest.json` + 运行记录 + 血缘 + data/code/files + 可选 `repro.lock`） |
| deliver | 课程模式 | `/studio/course` | 布置作业、收集并离线批改学生实验成果（需项目） |
| deliver | 作品画廊 | `/studio/gallery` | 浏览并重新打开社区分享的可复现作品 |
| utils | 单位换算 | `/studio/unit-convert` | 单位换算（无需项目） |
| utils | 计算器 | `/studio/calc` | 计算器（无需项目） |
| utils | 格式转换 | `/studio/format-convert` | 数据格式转换（无需项目） |
| utils | 有效数字 | `/studio/sigfig` | 有效数字处理（无需项目） |
| utils | 摩尔质量 | `/studio/molar-mass` | 摩尔质量计算（无需项目） |
| utils | 快速统计 | `/studio/quick-stats` | 快速描述统计（无需项目） |

配套内核补齐工具集：**单位系统**（量纲安全的 `Quantity` + `units.convert` / `units.check`）、**分块读取**（大型分隔符文件的异步行窗口读取）。产出文本结果的科研页面（分析摘要、图注、模型系数表等）带**保存到工作区**动作，直接写入项目 VFS。Figure Studio 之上还有**期刊投稿检查**（IEEE / Elsevier 规范，按 image / annotation / text / metadata 预检）、**图注起草器**（中英双语）与 **3D 场图**面板。来自各模式的运行记录统一汇入同一份历史与血缘图，"这张图由哪次运行、基于哪些数据产出？"始终可答，并随补充材料 ZIP 交付。

### 科研实验室实景

![Inference Forge — 浏览器内贝叶斯 MCMC（NUTS）](docs/assets/screenshots/platform/laboratory/inferenceforge-posterior.png)

*Inference Forge 在浏览器内（WebAssembly）运行 NUTS 采样：含 94% HDI / MCSE / R-hat / ESS 的后验摘要、WAIC / PSIS-LOO 模型对比、后验预测检查与轨迹 + 密度图。*

![Figure Studio — 出版级图表组合](docs/assets/screenshots/platform/laboratory/figurestudio-em.png)

*Figure Studio 组合出版级图表——此处为套用 IEEE 单栏模板的多面板图组，支持图注起草器、期刊投稿检查与 SVG / PDF / 600 dpi PNG 导出。*

![信号实验室 — 振动信号的 Welch PSD 功率谱](docs/assets/screenshots/platform/laboratory/signallab-psd.png)

*信号实验室执行频域分析——对加速度时序做 Welch PSD，主峰清晰可见；支持基 2 FFT 幅值谱 / 窗函数 / 滤波，并发送到 Figure Studio。*

![作品画廊 — 可复现科研作品库](docs/assets/screenshots/platform/laboratory/workgallery-gallery.png)

*作品画廊按学科汇聚可复现作品，每张卡片按复现锁状态（已锁定 / 检出漂移 / 未锁定）标记，便于发现、核验与引用。*

---

## 版本控制（Git 仓库化项目）

项目以 **Git 仓库**为存储底座：`src/core/git/` 定义单一 `GitAdapter` 接口，运行时按环境注入实现。

| 环境 | 实现 |
| ---- | ---- |
| 浏览器 | `isomorphic-git` + `LightningFS`（IndexedDB 承载工作区） |
| Node / 桌面端 | `simple-git`（运行时按需加载，驱动系统 `git` 二进制），不可用时回退 isomorphic-git |

适配器覆盖仓库生命周期（`init` / `clone` / `isRepo`）、读取（`status` / `log` / `diff` / `branches` / `remotes`）、写入（`add` / `commit` / `checkout` / `branch` / `merge`）、远程（`push` / `pull` / `fetch`）、钩子（`installHooks` / `getHook` / `removeHook`）、仓库 `config`，以及文件级辅助（`writeFile` / 删除 / 重命名 / 目录列举）。`projectStore` 每次保存都把快照镜像到工作区 `project.clproj`，因此侧边栏 **Git 面板**始终显示可审阅的真实变更；提交信息由 `generateCommitMessage` 按 Conventional Commits 生成（`save:` / `run:` / `figure:` / `manuscript:` 等）。

Git 面板已交付：分支 + 领先/落后计数、一键提交框（暂存全部待提交变更）、近期提交日志、分支创建（切换时拒绝丢弃未提交变更）、从 URL 克隆，以及远程同步（`pull` / `push` / `fetch`，走可配置的 CORS 代理——公共 isomorphic-git 代理并不覆盖所有托管站，如 Gitee）。自动提交在运行完成、图像保存、手动保存与补充材料导出时触发；`init` 会预装 Ergalics 钩子（`pre-commit` 校验 `repro.lock`、`pre-push` 跑单元测试），标准模板附带 GitHub Actions 工作流（`.github/workflows/ergalics.yml`）。文件级 diff 查看器与冲突向导仍在路线图上。

---

## 插件系统

### 内置插件

**148 个科学插件**启动时自动加载，侧边栏按 **19 个学科**分组。每个学科一张表——名称取自各 manifest 的 `nameI18n`（zh-CN / en-US）：

**图表可视化（22 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Scatter Plot | 散点图 | 数值列（x y [value]）二维散点，第三列可选颜色映射。 |
| Time Series | 时间序列绘图 | 将 CSV 列绘制为时间序列。 |
| Heatmap | 热力图 | 将二维数值场渲染为热力图。 |
| Contour | 等值线图 | 二维标量场的色带 + 等值线（涡量、地形数据皆宜）。 |
| 3D Surface | 3D 表面图 | 高度场网格 z = f(x,y)，数据来自项目文件或示例数据，自适应视角。 |
| 3D Voxel Field | 3D 体素渲染 | 三维标量场的等值面（方块体素或平滑 marching-tets）与半透明体素渲染。 |
| 3D Model Viewer | 3D 模型查看器 | 加载 GLB / GLTF / STL / OBJ / PLY 模型：着色 / 线框 / 法线 / X-ray 观察模式、剖面、两点测距、视角预设与 glTF 动画回放。 |
| Bar Chart | 柱状图 | 类别数据柱状图，水平/垂直方向，多配色可选。 |
| Bubble Chart | 气泡图 | 渲染 (x, y, size, [color]) 气泡，第 4 列可选颜色通道。 |
| Polar Plot | 雷达图 | 多系列雷达/极坐标图——每列一条轴，每行一个系列。 |
| Network Graph | 网络图 | 由边表构建力导向网络图，动画布局与节点大小。 |
| Sankey Diagram | 桑基图 | 由 source→target→value 边构建流图，流量按比例分配。 |
| Treemap | 矩形树图 | 面积正比于取值的嵌套矩形，适合层级数据。 |
| Parallel Coordinates | 平行坐标图 | 多变量平行轴，每行一条折线，可选颜色列。 |
| Point Cloud | 点云查看器 | 渲染 .xyz 点云，点大小可调。 |
| Point Cloud 3D | 3D 点云 | 宿主 Three.js 场景中的交互式三维点云，带高程着色与自动取景。 |
| Image Viewer | 图像查看器 | 查看位图图像（PNG / JPEG / WebP / GIF）。 |
| Histogram | 直方图 | 数值数据的分布直方图。 |
| Box Plot | 箱线图 | 分组数据的箱线图（四分位箱 + 触须 + 离群点）。 |
| Violin Plot | 小提琴图 | 核密度小提琴图，带宽可调，叠加箱线。 |
| QQ Plot | QQ 图（正态检验） | 样本分位数对标准正态分位数，偏离对角线即非正态信号。 |
| Error Band | 误差带图 | 折线图叠加阴影置信/误差带，适合噪声测量。 |

**数学与统计（19 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Linear Algebra Lab | 线性代数实验室 | 2×2 矩阵对单位网格的作用、特征向量几何、SVD 分解链 A = UΣVᵀ、向量组的张成与投影、\|det\| 作为面积缩放因子。 |
| Probability Distribution Lab | 概率分布实验室 | 10 个分布族（正态、泊松、指数、Beta、Gamma、Student-t、χ²、F、二项、几何）的 PDF/PMF + CDF，种子化蒙特卡洛直方图，样本数据集的闭式 MLE 拟合。 |
| Numerical Analysis Lab | 数值分析实验室 | 二分 / 牛顿 / 割线求根，梯形 / Simpson / Gauss 求积，前向 / 后向 / 中心差分，Lagrange / Newton / 三次样条插值，并实测收敛阶。 |
| Graph Theory Visualizer | 图论可视化 | 邻接矩阵 / 边表输入，Dijkstra / Bellman-Ford / Floyd-Warshall，Prim / Kruskal 最小生成树，Ford-Fulkerson / Edmonds-Karp 最大流 + 最小割，贪心着色、二分图匹配、欧拉 / 哈密顿路径，逐步动画。 |
| Topology Visualizer | 拓扑可视化 | Three.js 渲染 Möbius 带、Klein 瓶、环面与球面嵌入，基本群回路、同伦形变、欧拉示性数与可定向性分类。 |
| ODE Vector Field & Streamlines | ODE 向量场与流线 | 二维自治系统相平面：RK4 双向流线积分、平衡点定位与雅可比特征值分类。（微分方程 tier 的 ODE 求解器；PDE 覆盖位于物理套件——波动方程负责二维波方程，热传导 / 扩散方程实验室负责一维 / 二维热传导与 Laplace 问题。） |
| Game Theory Lab | 博弈论实验室 | n×n 收益矩阵、纯 / 混合 Nash 均衡、迭代占优、RK4 复制者动态 + ESS、扩展式博弈树逆向归纳，第一 / 第二价格与英式拍卖模拟及 VCG 指标。 |
| Fourier Series Lab | 傅里叶级数逼近实验室 | 数值傅里叶系数、部分和与 Fejér 平均对比、Parseval L² 误差与吉布斯过冲。 |
| Domain Coloring | 复变函数域着色 | 复函数 f(z) 的逐像素域着色，内置表达式解析器，支持缩放平移。 |
| Central Limit Theorem Bench | 中心极限定理演示台 | 从均匀 / 指数 / 伯努利 / 双峰 / 截尾帕累托总体抽取样本均值，叠加解析 N(μ, σ²/n)，报告偏度 / 峰度 / Jarque–Bera。 |
| Markov Chains & Stationary Analysis | 马尔可夫链与稳态分析 | 幂迭代求平稳分布（L1 残差 < 1e-12）、不可约性与周期检测、吸收链分析。 |
| Zipf's Law Word Frequencies | Zipf 定律词频分析 | 真实语料的 Zipf 定律拟合（log rank–log freq 最小二乘，s±σ、R²），内置《Emma》公版语料。 |
| Design of Experiments | 试验设计（DOE） | 全因子 / 部分因子与响应面分析：编码设计矩阵、主效应与二阶交互的最小二乘估计、含偏 η² 的方差分析、正交性诊断与田口信噪比。 |
| Time Series Analysis | 时间序列分析 | ACF/PACF、加法与乘法季节分解、ADF/KPSS/Phillips–Perron 单位根检验、按 AIC 选择的 ARIMA 与预测带、GARCH(1,1) 波动率以及 Granger 因果 F 检验。 |
| Multivariate Analysis | 多元统计分析 | PCA 双标图、varimax 因子分析、Ward / k-means / DBSCAN 聚类（含轮廓系数）、LDA / QDA 分类、典型相关分析与马氏距离异常检测。 |
| Nonparametric Tests | 非参数检验 | Mann–Whitney U、Wilcoxon 符号秩、Kruskal–Wallis、Friedman、精确符号检验、单/双样本 Kolmogorov–Smirnov、Spearman ρ 与 Kendall τ-b，并给出效应量与 p 值。 |
| Survival Analysis | 生存分析 | Kaplan–Meier 曲线（Greenwood 方差与 log-log 置信带）、k 样本 log-rank 检验，以及 Cox 比例风险模型（Breslow 结处理、Newton–Raphson）并给出风险比与 Harrell C。 |
| Meta-Analysis | 元分析 | 逆方差固定效应合并、DerSimonian–Laird 随机效应、Cochran Q、I²、τ²、森林图与漏斗图数据、Egger 回归、剪补法与亚组合并。 |
| Bayesian Inference | 贝叶斯推断 | 随机游走 Metropolis–Hastings、共轭 Gibbs 与哈密顿蒙特卡洛、后验预测检验、Savage–Dickey 贝叶斯因子、分层随机截距以及 R̂ / ESS 收敛诊断。 |

**物理模拟（16 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Particles | 粒子模拟 | 基于 WGSL 计算内核的交互式粒子模拟。 |
| N-Body Gravity | 引力 N 体模拟 | 三维直接求和引力，GPU 全对内核 + CPU 回退。 |
| LBM Fluid | 流体模拟（LBM） | 二维 D2Q9 格子 Boltzmann 通道绕流。 |
| 3D Fluid Flow | 三维流体绕流 | D3Q19 格子 Boltzmann 三维绕流：任意 GLB/GLTF/STL/OBJ/PLY 模型进入流场，切片/涡量/示踪粒子可视化并给出阻力/升力。 |
| Wave Equation | 波动方程 | 二维有限差分波动方程：高斯脉冲、双源干涉、双缝衍射。 |
| Double Pendulum | 双摆（混沌） | RK4 双摆，偏移 0.001 rad 的幽灵摆指数发散——混沌可视化。 |
| Electromagnetism | 电磁场 | 可拖动电荷在库仑力与洛伦兹力（独立设置的 B 场）下运动。 |
| Optics Lab | 光学实验 | 几何光学光线追踪：薄透镜、色散棱镜、可拖动光屏。 |
| EM Eigensolver | 电磁谐振特征值求解器 | 稀疏厄密特征值：thick-restart Lanczos / 块 LOBPCG / Jacobi-Davidson + MINRES 位移反演。 |
| 1D-3D Coupled Solver | 1D-3D 双向耦合求解器 | 1D 管网与 3D 场双向耦合：多速率子循环、毫秒级阀门控制。 |
| 1-D Schrödinger Solver | 一维量子力学求解器 | 有限差分特征值求解器，覆盖无限深势阱 / 谐振子 / 有限深 / 双势阱。 |
| 2-D Ising Model | 二维伊辛模型 | 周期格点上的 Metropolis 与 Wolff 蒙特卡洛，含磁化率与关联诊断。 |
| Heat Engine Cycles | 热机循环 p-V 分析台 | Otto / Diesel / Carnot / Stirling 循环的准静态 p-V 积分分析。 |
| Diffusion Equation Lab | 热传导 / 扩散方程实验室 | FTCS 显式与 Crank–Nicolson 步进，带稳定性门槛与 Dirichlet / Neumann 边界。 |
| Diffraction Lab | 衍射实验室 | 数值计算 Fresnel–Kirchhoff 衍射积分，覆盖单缝与多缝图样。 |
| Trajectory Kinematics Lab | 轨迹运动学与能量分解实验室 | 轨迹表 → 差分速度、动能/势能分解与最小二乘抛体拟合。 |

**化学（5 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Crystal · 3D Unit Cell | 晶胞 · 3D 预览 | 加载 CIF / POSCAR / XYZ 晶胞，在三维中查看原子、周期键与密度。 |
| Reaction · MD 3D | 反应 · 自由反应动力学 3D | 三维 Langevin 分子动力学——键越过 Arrhenius 势垒即断裂。 |
| Titration Curve Lab | 酸碱滴定曲线实验室 | 由完整电荷 + 质量平衡求解的酸碱滴定曲线。 |
| Reaction Order & Arrhenius | 反应级数判定与 Arrhenius 分析 | [A]–t 数据的零/一/二级线性化，按 R² 择优定级数，输出 k ± σ。 |
| Gray–Scott Turing Patterns | Gray-Scott 反应扩散图灵斑图 | 显式 FTCS 反应扩散实验室，按 Pearson (1993) 图样分类。 |

**生物学（6 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Protein Interactions | 蛋白质交互网络 | 力导向布局的 PPI 网络，报告度、连通分量、模块。 |
| Enzyme Kinetics | 酶动力学 | 米氏动力学含三种抑制类型，LM 拟合恢复 Vmax 与 Km。 |
| Sequence Alignment | 序列比对与分析 | BLOSUM62 / 核苷酸的 Needleman–Wunsch 或 Smith–Waterman（仿射间隙），附 GC / 密码子统计。 |
| Population Genetics | 群体遗传学 | Hardy–Weinberg χ² 检验 + 种子化可复现的 Wright–Fisher 漂变（可选选择压力）。 |
| Mendel F2 χ² Tests | 孟德尔 F2 分离比 χ² 检验 | 3:1 / 9:3:3:1 分离比的 χ² 拟合优度检验，内置 1866 年七对性状数据集。 |
| Hodgkin–Huxley Neuron | Hodgkin–Huxley 神经元 | 1952 年动作电位模型，使用原始发表常数，RK4 积分。 |

**医学与公共卫生（6 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Epidemic Modeling | 传染病分室模型 | 确定性 SIR / SEIR 的 RK4 积分，报告 R₀、群体免疫阈值与累计感染率，另支持多区域耦合与基于发病率序列的 Cori 式 Rt 估计。 |
| Pharmacokinetics | 药代动力学室分析 | 一/二室 PK 模型（静注推注 / 滴注 / 一级口服吸收），叠加治疗窗，另支持群体模拟、DDI 相互作用情景与 TDM 曲线拟合。 |
| ECG Analyzer | 心电图分析仪 | Pan–Tompkins R 峰检测、P/QRS/T 标注、时域 / 频域 HRV 与规则式心律筛查，支持单 / 多导联文本与 WFDB 记录。 |
| Medical Image Viewer | 医学影像查看器 | 教学级 DICOM Part-10 查看器：HU 换算、窗宽窗位切片浏览、阈值等值面 3D 重建、处理视图与 ROI 统计。 |
| Biostatistics Toolkit | 生物统计工具箱 | 五模式工作台：样本量 / 功效设计、种子化随机化方案、两臂终点分析、α 消耗期中边界与 PRR 不良事件信号筛查。 |
| Genomics Visualizer | 基因组可视化器 | 五模式查看器：GWAS Manhattan + QQ（含基因组膨胀因子）、差异表达火山图、LD r² 热图、preranked GSEA 与 Circos 重排图。 |

**地理（16 个）**——本系列全部支持一键**发送 Figure Studio**：

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| GeoJSON Map | GeoJSON 地图 | 离线 GeoJSON 渲染，按属性分级设色。 |
| Solar Elevation & Day Length | 太阳高度与昼夜长短 | 给定纬度与日期，计算赤纬、正午太阳高度、昼长与日出日落。 |
| Climatograph | 气候直方图 | 月度气候图（温度折线 + 降水柱状，双轴）与年度摘要。 |
| Population Pyramid | 人口金字塔 | 背靠背年龄-性别金字塔，含 0-14 / 15-64 / 65+ 占比与性别比。 |
| Spatial Interpolation | 空间插值 | IDW 与普通克里金网格化，LOOCV 验证 + Moran's I。 |
| Distance & Area Measure | 距离与面积量算 | 点击取点，输出大圆距离与封闭球面多边形面积。 |
| Projection Distortion (Tissot) | 投影变形（Tissot 圆） | 世界海岸线叠加 Tissot 变形圆，覆盖七种投影。 |
| DEM Terrain Analysis | DEM 地形分析 | ESRI ASCII Grid 高程 → 山体阴影、Horn 法坡度/坡向、等高线与可环绕三维网格。 |
| GPX Track Analysis | GPX 轨迹分析 | 解析 GPX 轨迹点：总距离、累计爬升/下降（滞回滤波）、时长与高程剖面。 |
| Interactive Globe (3D) | 交互地球仪（3D） | 可拖拽旋转的真三维地球，Natural Earth 110m 海岸线 + 球面 Tissot 变形圆。 |
| Radiocarbon Dating Lab | 放射性碳定年实验室 | Libby 传统年龄按 IntCal20 曲线做似然剖面校准。 |
| Soil Water Retention Fit | 土壤水分特征曲线拟合 | van Genuchten (1980) 曲线的带界 LM 拟合，输出协方差标准误。 |
| SCS Runoff Event | SCS 降雨径流模型 | SCS 曲线数降雨超渗与合成单位线的卷积。 |
| Seismic Wave Propagation | 地震波传播实验室 | 分层 PREM 类地球模型上的 P/S 射线理论走时、直接波影区、含震相拾取的合成三分量地震图、震源机制沙滩球，以及里氏 / 矩震级 / 麦加利烈度换算。二维 P/S 有限差分波场模拟，带 WGSL 快路径与 CPU 回退。 |
| Mineral Identification Lab | 矿物鉴定实验室 | 基于内置 24 种矿物参考数据库的物性加权鉴定（硬度、解理、光泽、条痕、比重；可导入 CSV/TSV 替换为自己的矿物库）、莫氏刻划测试、晶胞参数 → 晶系判定、分类路径，以及 30 µm 薄片的米歇尔-列维干涉色模拟。 |
| Hydrogeology Workbench | 水文地质模拟工作台 | Theis / Cooper–Jacob 承压含水层降深、Darcy 渗流速度、多井叠加与降落漏斗、含阻滞与衰减的 Ogata–Banks 运移、抽水试验拟合，以及潮汐 / 气压水位响应。 |

**环境学（8 个）**——严格数据驱动，示例经"示例数据"对话框加载：

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Air Quality (AQI) | 空气质量评价（AQI） | 按 HJ 633-2012 计算各污染物 IAQI 与日 AQI 并评级。 |
| Water Quality | 水质评价（地表水分类） | 各指标按 GB 3838-2002 定类（Ⅰ–Ⅴ），单因子最差类别决定总评。 |
| Greenhouse Effect | 温室效应模拟 | 零维辐射收支教学模型，CO₂ / 反照率 / 云量滑块驱动（Myhre 1998 强迫）。 |
| Carbon Cycle | 碳循环推演 | 四碳库箱模型（大气 / 植被 / 土壤 / 海洋），排放情景 + 蒙特卡洛 95% 区间。 |
| Biodiversity Indices | 生物多样性指数 | 由丰度矩阵计算各样点的丰富度、Shannon H′、Gini-Simpson 与 Pielou 均匀度。 |
| Pollutant Dispersion | 污染物扩散模拟（高斯烟羽） | 高斯烟羽地面浓度，Pasquill–Gifford 扩散参数。 |
| 3-D Global Environment | 3D 全球环境 | 三维地球上的教学近似 CO₂、反照率与表层洋流图层。 |
| Predator–Prey (Lotka–Volterra) | 捕食者-猎物（Lotka–Volterra） | RK4 求解含相图，并以守恒不变量做数值校验。 |

**天文（3 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Astronomy CCD Pipeline | 天文 CCD 管线 | FITS 改正：bias/dark/flat 校准、宇宙线剔除、孔径测光。 |
| Exoplanet Transit Fitting | 凌星系外行星光变拟合 | 简化 BLS 周期检测 + Levenberg–Marquardt 梯形拟合与相位折叠。 |
| Hertzsprung–Russell Diagram | 赫罗图（HR 图） | 颜色-星等工作台，叠加经验主序参考线。 |

**材料学（3 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| XRD Pattern Analysis | XRD 衍射图谱分析 | 峰位检测、Bragg d 值换算与晶格参数最小二乘精修。 |
| Stress-Strain Analysis | 应力-应变分析 | 按 ASTM E8 / GB/T 228 提取拉伸性能，0.2% 偏移屈服。 |
| Thermal Analysis (DSC/TGA) | 热分析（DSC/TGA） | 基线校正峰检测、外推起始温度与转变焓。 |

**工程仿真（5 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Structural Mechanics | 结构力学 | 桁架承载——杆件随轴力发热、超载断裂直至垮塌。 |
| DC Circuit Node Analysis | 直流电路节点分析 | 直流电阻电路的改进节点法（MNA），部分主元高斯消元。 |
| Plane Truss FEA | 平面桁架有限元分析 | 每节点 2 自由度杆单元、刚度组装与约束凝聚。 |
| Control Systems Lab | 控制系统实验室 | 一/二阶对象 + PID 单位反馈：阶跃响应指标与 Bode 扫频。 |
| FEM Lab | 有限元实验室 | 参数化二维区域 Delaunay 网格、P1 有限元组装与共轭梯度求解（Poisson / 瞬态热传导 / 平面弹性），附收敛基准与变形叠加。 |

**经济与金融（2 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Black-Scholes Option Lab | Black-Scholes 期权定价实验室 | 解析价格与希腊字母对照种子化蒙特卡洛引擎验证。 |
| Spatial Prisoner's Dilemma | 空间囚徒困境演化博弈 | Nowak–May 格点博弈——合作/背叛在 8 邻域上演化，可选突变。 |

**心理与行为（2 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Signal Detection ROC / d′ | 信号检测论 ROC / d′ 分析 | 由击中/虚报率计算 d′、β、判断标准 c 与 AUC，解析 ROC 曲线。 |
| Reaction Time Lab | 简单反应时实验室 | 浏览器内简单反应时实验，精确 95% t 区间与跨条件 Welch 检验。 |

**社会科学（5 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Population Forecasting | 人口预测模型 | Leslie 矩阵年龄分组投影，含分龄生育/存活率、生育情景、净迁移、人口金字塔动画与联合国口径的老龄化/人口红利分析。 |
| Voting System Simulator | 投票制度模拟器 | 多数制 / IRV / 博达 / 计分 / 顿特比例代表制对比，孔多塞判据检验，分票效应与杰利蝾螈演示（空间选民模型）。 |
| Social Network Analyzer | 社会网络分析器 | 中心性（度/介数/接近/特征向量/PageRank）、Louvain–Girvan-Newman 社区发现与独立级联/线性阈值影响传播。 |
| Inequality Analyzer | 不平等分析器 | 精确基尼系数及自助置信区间、洛伦兹曲线、Palma / Theil / Atkinson 指标、代际流动模拟与税制再分配分析。 |
| Public Opinion Diffusion | 舆论传播模型 | 独立级联与线性阈值传播、回音室指标、谣言/核查竞争级联与贪心影响最大化选种。 |

**计算机科学（7 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Algorithm Visualizer | 算法可视化器 | 逐步演示排序、查找与图遍历，实时统计比较/交换次数，并并排比较不同算法的运算量。 |
| Data Structure Lab | 数据结构实验室 | BST / AVL / 大根堆 / 分离链哈希表，带操作历史、旋转标注与每步复杂度说明。 |
| Automata & Regex Engine | 自动机与正则引擎 | 正则 → Thompson NFA → 子集构造 DFA → 最小化 DFA，并逐字符展示匹配轨迹。 |
| Cryptography Lab | 密码学实验室 | RSA 往返、FIPS-197 AES-128、SHA-256、P-256 点运算与雪崩分析，参数可由用户输入。 |
| Neural Network Visualizer | 神经网络可视化器 | 在 XOR / 圆环 / 螺旋数据集上反向传播训练 MLP，展示损失曲线、梯度校验与决策边界网格。 |
| Complexity Analyzer | 复杂度分析器 | 将实测 n/time 数据拟合到 O(1)、O(log n)、O(n)、O(n log n)、O(n²)、O(n³) 与 O(2ⁿ)，并恢复双对数指数。 |
| Network Protocol Simulator | 网络协议模拟器 | TCP 握手/挥手、TLS 1.3 1-RTT 报文流与离散 Reno 拥塞窗口轨迹，时间均以 RTT 计。 |

**仿真引擎（4 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Monte Carlo Simulation Platform | 蒙特卡洛仿真平台 | 分布库（均匀 / 正态 / 三角 / PERT / beta / 经验分布）、高斯 Copula 相关、简单随机 / 拉丁超立方 / Sobol 抽样，均值-方差-分位数统计与置信区间、滑动均值与 Gelman-Rubin 收敛诊断、龙卷风敏感性分析、散点视图与 CSV 导出。 |
| Agent-Based Modeling Framework | 基于智能体的建模框架 | 网格与环形连续世界、声明式转移/移动规则引擎、参数网格批量运行、智能体序列聚合，内置四套模板：Schelling 隔离、含草地的捕食者-猎物、Deffuant 舆论动力学与 Nagel-Schreckenberg 交通流。 |
| System Dynamics Studio | 系统动力学工作台 | 可编辑 JSON 存量-流量模型与速率方程、Euler/RK4 积分、带极性的因果回路图、基于回路主导性启发式的反馈回路检测、参数扫描，以及从逻辑斯蒂增长到 Bass 扩散的五套模板。 |
| Discrete Event Simulator | 离散事件仿真 | 基于二叉堆事件调度器的排队网络：多服务台、有限容量阻塞与返工路由；利用率、时间加权队列长度、Little 定律校验、M/M/1 与 M/M/c（Erlang-C）解析对照、瓶颈识别与四套模板。 |

**数据与智能（8 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| AI Trainer | AI 训练 | TF.js 回归 / 分类训练，实时损失曲线与可视化。 |
| Image Processing | 图像处理 | 二维 FFT、卷积、高斯模糊、Sobel 边缘与直方图均衡。 |
| AutoML Pipeline | AutoML 流水线 | 自动化预处理（缺失填补、z-score、独热编码、特征选择），ridge / 逻辑斯蒂 / k-NN / 朴素贝叶斯 / CART 模型族，网格 / 随机 / 贝叶斯式超参搜索，k 折交叉验证（accuracy / F1 / AUC / RMSE / R²），流水线 JSON 导出与可复现的固定种子运行。 |
| NLP Workbench | 自然语言处理工作台 | 分词（停用词 + 词干化）、平滑 TF-IDF 文档-词矩阵、坍缩 Gibbs 采样 LDA 主题模型、词典 + 朴素贝叶斯情感分析、规则式 NER、tf-idf 向量上的 k-means 聚类（附 PCA 散点与各模式 CSV 导出）。 |
| Recommender System Simulator | 推荐系统模拟器 | 基于用户 / 基于物品的协同过滤、基于内容的 ridge 回归、ALS 矩阵分解、混合融合，precision@K / recall@K / NDCG@K / MAP / RMSE 评估（留出集切分与冷启动兜底覆盖率）。 |
| Reinforcement Learning Lab | 强化学习环境 | 可配置 GridWorld（陷阱、滑动、步代价）、CartPole 物理与多臂老虎机；Q-Learning、SARSA、REINFORCE、ε-greedy、UCB1 与 Thompson 采样，奖励曲线、遗憾值、Q 表快照、策略箭头与可中止的回合循环。 |
| Model Interpreter | 模型解释器 | 置换重要性、部分依赖、LIME 局部代理、带局部精度残差的 KernelSHAP、反事实搜索与公平性指标（人口平等、机会均等、差异影响），基于内置 logistic / ridge 参考模型。 |
| Vector Database | 向量数据库 | 浏览器内向量库：余弦 / 欧氏 / 点积度量上的精确暴力与简化 HNSW 索引、哈希技巧文本与数值嵌入、PCA 与精确 t-SNE 投影、recall@K 评估与检索延迟基准。 |

**特效渲染（7 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Black Hole · 3D Ray Tracer | 黑洞 · 3D 光线追踪 | 逐像素 Schwarzschild 测地线积分，多普勒集束吸积盘。 |
| Water · 3D Fluid Waves | 水波 · 3D 流体 | FDTD 波动方程求解器（交互落滴）+ Gerstner 深水波。 |
| Volumetric Clouds · Sky Renderer | 体积云 · 天空渲染器 | 光线步进体积云，Beer–Lambert 消光 + Henyey–Greenstein 散射。 |
| Daylight Sky · Atmosphere | 日光天空 · 大气散射 | Nishita 风格解析大气：Rayleigh + Mie，暮光与临边昏暗太阳。 |
| Starfield · Night Sky | 星空 · 夜天渲染器 | 程序化恒星、银道面银河、恒星时自转与 Bortle 光污染模型。 |
| Ocean Swell · Sunrise & Sunset | 波浪海面 · 日升日落 | 离散化 Pierson–Moskowitz 海浪谱驱动的 Gerstner 波列，双瓣太阳光路、菲涅耳水体与海雾。 |
| Misty Peaks · Layered Ridges | 雾锁青山 · 叠嶂云海 | 脊状噪声雕刻的近→远山脊剪影，真实太阳照明，大气透视与 Koschmieder 能见度雾带。 |

**音乐与艺术科学（4 个）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Acoustics Lab | 声学实验室 | 导入外部音频（WAV / MP3 / M4A / AAC / OGG / Opus / FLAC / WebM）或波形 CSV，进行波形、FFT 频谱、谐波/过音列与 THD 分析；拍频与相干叠加演示；矩形房间本征模态、Sabine/Eyring 混响时间、Schroeder 频率与临界距离。启动为空状态，绝不自动播放。 |
| Tuning System Calculator | 音律系统计算器 | 12-TET 音名→频率映射，纯律 / 毕达哥拉斯 / 中全音律 / Werckmeister 对比，音分偏差网格，教会调式与音程分析，自定义音律 CSV 导入。 |
| Synthesizer Lab | 合成器实验室 | ADSR 包络编辑、RBJ 低通/高通/带通/陷波响应、正弦/方波/锯齿/三角/波表振荡器、FM 合成、LFO 调制，离线渲染 16-bit WAV 与 JSON 预设导入。启动为空状态，导入预设或点「新建预设」开始设计。 |
| Color Science Lab | 色彩科学实验室 | CIE 1931 xy 与 1976 u′v′ 色度图（含 sRGB 色域）、RGB/HSV/HSL/Lab/LCH/XYZ 换算、CIEDE2000 / ΔE76 色差、配色调和规则、红色盲/绿色盲/蓝色盲模拟、调色板 CSV 导入与 WCAG 对比度评估。启动为空状态，导入调色板 CSV 后显示。 |

**趣味工具（10 个，全部 `autoload: false`，按需从内置面板或市场加载）**

| 插件（英文名） | 中文名 | 定位 |
| --- | --- | --- |
| Fractal Explorer | 分形浏览器 | Mandelbrot 与 Julia 集合，多配色缩放浏览。 |
| Spirograph | 万花尺 | 内摆线 / 外摆线螺旋图案。 |
| Lissajous | 利萨茹曲线 | 动画利萨茹参数曲线，频率相位可调。 |
| Conway's Game of Life | 生命游戏 | 经典细胞自动机，支持播放/暂停/重新播种。 |
| Harmonograph | 谐振记录仪 | 衰减正弦叠加生成的曲线艺术。 |
| Palette Explorer | 配色探索器 | 双色渐变预览与自动色卡。 |
| Koch Snowflake | 科赫雪花 | 递归线段构造的科赫雪花分形。 |
| Barnsley Fern | 巴恩斯利蕨 | 四个仿射变换（IFS）生成的蕨类。 |
| Fireworks | 烟花 | 带重力与拖尾的粒子烟花。 |
| Truchet Tiles | 特鲁谢瓷砖 | 随机朝向的四分之一圆瓷砖拼出流动图案。 |

模拟类插件严格数据驱动：初始为空、绝不伪造默认场景，**重置**仅重放已加载的数据。每个科学插件都附示例数据集（`examples/data/` 共 189 个文件），经 **示例** 对话框一键加载即可产出真实可视化；模型查看器另附 5 个示例 3D 模型（STL / OBJ / PLY / glTF / GLB）。

插件还可声明**科研元数据**（`manifest.research`）——科研就绪分级（研究级 / 准研究级 / 演示级 / 教学演示），在市场与详情面板以语义色徽章呈现，并附带物理量单位、验证基准 id 与适用范围说明；同时可向视口下方的共享**科学输出栏**发布结构化结论（拟合质量、残差、置信区间、收敛 / 守恒诊断），让每张图都不缺数值依据。

### 插件图览

两个赛题级科学求解器的内核运行在 Pyodide Worker 内（独立专题文档 `docs/technical/09`、`docs/technical/10`；独立仓库：gitee.com/cnt-code/em-eigensolver、gitee.com/cnt-code/fluid-cfd-coupler）：

![EM Eigensolver — 二维求解报告](docs/assets/screenshots/plugins/em-eigensolver/solve-report.png)

*EM Eigensolver——稀疏厄密特征值求解器（thick-restart Lanczos / 块 LOBPCG / Jacobi-Davidson + MINRES 位移反演），输出二维谱报告与三维模式场。*

![Fluid CFD Coupler — Case A 的三维体素场](docs/assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-a.png)

*Fluid CFD Coupler——1D 管网与 3D 标量场双向耦合，带守恒审计；此处为验证工况 A 的三维体素场。*

其中四个依赖非平凡计算路径的插件：

![N-Body Gravity — 4096 体环形星环（3D, WGSL 全对）](docs/assets/screenshots/plugins/nbody-3d.png)

*N-Body Gravity 用 WGSL 全对引力内核在 GPU 上模拟直和引力，每步 O(N²)。*

![AI Trainer — 在 200 张合成数字图上训练 MNIST CNN，网格展示预测值（绿）与真值（红）](docs/assets/screenshots/plugins/ai-mnist.png)

*AI Trainer 用 TensorFlow.js 在浏览器内训练线性 / 非线性 / 逻辑回归 / 卷积模型，TF.js 在首次点击 Train 时懒加载（~2 MB）。*

![GeoJSON Map — Albers（中国）投影下的中国省份分级设色地图](docs/assets/screenshots/plugins/geojson-map.png)

*GeoJSON Map 离线渲染矢量地图并按属性分级设色，支持 Albers / 墨卡托 / 等距圆柱投影。*

三个可交互物理实验室作为旗舰演示（对象可直接在画布上操作）：

![电磁场 — 电荷在均匀磁场中回旋](docs/assets/screenshots/plugins/electromagnetism.png)

*电磁场：可拖动电荷在库仑力与洛伦兹力下运动，回旋加速器示例让电荷旋入半径由速度 / 质量 / B 决定的螺线。*

![光学实验 — 白光束经三棱镜色散为光谱](docs/assets/screenshots/plugins/optics-prism.png)

*光学实验：几何光学光线追踪（薄透镜、斯涅尔折射 + 色散三棱镜、可拖动光屏）。*

![结构力学 — 17 杆桥面桁架承载两个重物，杆件按轴力着色](docs/assets/screenshots/plugins/structure-truss.png)

*结构力学：铰接桁架按轴力着色并显示利用率读数，超载断裂直至垮塌。*

**更多插件实景**（地理 / 流体仿真 / 生命科学 / 化学）：

![LBM 流体 — D2Q9 通道流嘴卡门涡街](docs/assets/screenshots/plugins/lbm-fluid.png)

*LBM 流体用 D2Q9 格子 Boltzmann 的 collide+stream 双内核模拟通道绕流，涡量场实时显示卡门涡街的脱落。*

![交互地球仪 — 可拖拽旋转的真三维地球](docs/assets/screenshots/plugins/globe-3d.png)

*交互地球仪把 Natural Earth 110m 海岸线与经纬网贴在球面上并叠加球面 Tissot 变形圆，支持滚轮缩放与自动自转。*

![DEM 地形分析 — 高程设色与坡度分级](docs/assets/screenshots/plugins/terrain-slope.png)

*DEM 地形分析解析 ESRI ASCII Grid 高程，给出山体阴影、Horn 法坡度 / 坡向与等高线，并支持可拖拽旋转的三维建模视图。*

![空间插值 — IDW 与普通克里金网格化](docs/assets/screenshots/plugins/spatial-interpolation.png)

*空间插值把离散站点观测网格化：反距离加权（幂次可调）与普通克里金（球状 / 指数经验变差函数自动拟合）输出热力面、等值线与站点标注。*

![酶动力学 — 米氏方程 LM 曲线拟合](docs/assets/screenshots/plugins/bio-enzyme/saturation.png)

*生物酶插件对底物-速率数据做米氏方程非线性 LM 拟合，输出 K_m 与 V_max 及置信区间。*

![晶胞 3D 预览 — 物相结构带电压面](docs/assets/screenshots/plugins/chem-crystal/cell3d.png)

*化学晶体插件把晶胞渲染为真三维结构，可沿任一轴旋转并叠加电子密度等值面。*

**分学科图览**（图表 / 数学与统计 / 物理 / 化学 / 生物 / 地理 / 环境学 / 特效渲染）：

**图表可视化**

![桑基图 — 跨层级流量彩带](docs/assets/screenshots/plugins/sankey.png)

*桑基图：跨层级的能量 / 流量彩带。*

![3D 表面图 — 可旋转网格曲面](docs/assets/screenshots/plugins/surface-3d.png)

*3D 表面图：高度场 z = f(x, y) 的可旋转网格曲面。*

![散点图 — 三簇着色点云与图例](docs/assets/screenshots/plugins/scatter.png)

*散点图：三簇着色点云，由图例区分。*

![时间序列绘图 — 趋势线叠加含噪采样](docs/assets/screenshots/plugins/timeseries.png)

*时间序列绘图：拟合趋势线叠加含噪采样点。*

![气泡图 — 大小与颜色双通道编码](docs/assets/screenshots/plugins/bubble.png)

*气泡图：两个附加变量分别映射气泡大小与颜色。*

![热力图 — Viridis 配色的花瓣图案](docs/assets/screenshots/plugins/heatmap.png)

*热力图：Viridis 配色的花瓣图案。*

![3D 体素渲染 — 青色球体](docs/assets/screenshots/plugins/voxel-3d.png)

*3D 体素渲染：青色球体体素视图。*

![柱状图 — 带数值标签的月度柱状图](docs/assets/screenshots/plugins/bar_chart.png)

*柱状图：带数值标签的月度柱状图。*

![雷达图 — 五维雷达图](docs/assets/screenshots/plugins/polar.png)

*雷达图：五维雷达图。*

![网络图 — 力导向布局](docs/assets/screenshots/plugins/network.png)

*网络图：力导向布局网络图。*

![平行坐标图 — 鸢尾花数据集](docs/assets/screenshots/plugins/parallel.png)

*平行坐标图：鸢尾花数据集，每行一条折线。*

![矩形树图 — 面积正比取值的嵌套矩形](docs/assets/screenshots/plugins/treemap.png)

*矩形树图：面积正比取值的嵌套矩形。*

![点云查看器 — 二维点云](docs/assets/screenshots/plugins/point-cloud.png)

*点云查看器：二维 .xyz 点云。*

![直方图 — 双峰分布](docs/assets/screenshots/plugins/histogram.png)

*直方图：双峰分布。*

![小提琴图 — 核密度小提琴叠加箱线](docs/assets/screenshots/plugins/violin.png)

*小提琴图：核密度小提琴叠加箱线。*

![箱线图 — 四分位箱与离群点](docs/assets/screenshots/plugins/boxplot.png)

*箱线图：四分位箱与离群点。*

![误差带图 — 均值折线叠加误差带](docs/assets/screenshots/plugins/errorband.png)

*误差带图：均值折线叠加误差带。*

![QQ 图 — 样本分位数偏离参考线](docs/assets/screenshots/plugins/qqplot.png)

*QQ 图：样本分位数偏离参考线。*

**数学与统计**

![马尔可夫链与稳态分析 — 状态转移图与样本轨迹](docs/assets/screenshots/plugins/stats-markov.png)

*马尔可夫链与稳态分析：状态转移图与一条穿越样本轨迹。*

![Zipf 定律词频分析 — 双对数词频直线拟合](docs/assets/screenshots/plugins/stats-zipf.png)

*Zipf 定律词频分析：log rank–log freq 双对数直线拟合。*

![中心极限定理演示台 — 样本均值叠加解析正态](docs/assets/screenshots/plugins/stats-clt.png)

*中心极限定理演示台：样本均值叠加解析正态曲线。*

![复变函数域着色 — 辐角与模长彩色场](docs/assets/screenshots/plugins/math-domaincolor.png)

*复变函数域着色：复函数 f(z) 的逐像素辐角 / 模长彩色场。*

![傅里叶级数逼近实验室 — 方波的部分和逼近](docs/assets/screenshots/plugins/math-fourier.png)

*傅里叶级数逼近实验室：方波的部分和逼近与傅里叶系数。*

![ODE 向量场与流线 — 箭头场与流线](docs/assets/screenshots/plugins/math-odefield.png)

*ODE 向量场与流线：向量箭头场与积分流线。*

**物理模拟**

![二维伊辛模型 — 自旋构型与热容峰](docs/assets/screenshots/plugins/physics-ising.png)

*二维伊辛模型：Metropolis 自旋格点构型与临界点附近的热容峰。*

![热传导 / 扩散方程实验室 — 数值解与解析解对比](docs/assets/screenshots/plugins/physics-diffusion.png)

*热传导 / 扩散方程实验室：数值解与解析解对比。*

![衍射实验室 — 单缝衍射条纹](docs/assets/screenshots/plugins/physics-diffraction.png)

*衍射实验室：单缝强度分布与条纹图样。*

![轨迹运动学与能量分解实验室 — 抛体拟合与能量分解](docs/assets/screenshots/plugins/physics-trajectory.png)

*轨迹运动学与能量分解实验室：最小二乘抛体拟合与动能 / 势能分解。*

![粒子模拟 — GPU 粒子模拟](docs/assets/screenshots/plugins/particles.png)

*粒子模拟：WGSL 计算内核上的交互式粒子模拟。*

![一维量子力学求解器 — 无限深方势阱定态波函数](docs/assets/screenshots/plugins/physics-schrodinger.png)

*一维量子力学求解器：无限深方势阱的定态波函数。*

![热机循环 p-V 分析台 — 奥托循环与效率](docs/assets/screenshots/plugins/physics-heatengine.png)

*热机循环 p-V 分析台：奥托循环 p-V 图与效率。*

**化学**

![Gray-Scott 反应扩散图灵斑图 — 斑点与条纹](docs/assets/screenshots/plugins/chem-turing.png)

*Gray-Scott 反应扩散图灵斑图：周期域上的斑点与条纹图样。*

![酸碱滴定曲线实验室 — pH 突跃与等当点](docs/assets/screenshots/plugins/chem-titration.png)

*酸碱滴定曲线实验室：等当点附近的 pH 突跃。*

![反应级数判定与 Arrhenius 分析 — 积分法三联线性拟合](docs/assets/screenshots/plugins/chem-reaction-order.png)

*反应级数判定与 Arrhenius 分析：零 / 一 / 二级积分法线性拟合并列。*

**生物学**

![孟德尔 F2 分离比 χ² 检验 — 分离比拟合优度](docs/assets/screenshots/plugins/bio-mendel.png)

*孟德尔 F2 分离比 χ² 检验：F₂ 分离比的 χ² 拟合优度检验。*

![Hodgkin–Huxley 神经元 — 动作电位与门控变量](docs/assets/screenshots/plugins/bio-neuron.png)

*Hodgkin–Huxley 神经元：动作电位与 m / n / h 门控变量。*

![酶动力学 — v–[S] 曲线与抑制情形拟合](docs/assets/screenshots/plugins/bio-enzyme/inhibition.png)

*酶动力学：各抑制类型下的 v–[S] 曲线拟合，输出 Vmax / Km 置信区间。*

![群体遗传学 — Wright–Fisher 漂变轨迹](docs/assets/screenshots/plugins/bio-popgen/drift-replicates.png)

*群体遗传学：40 条种子化 Wright–Fisher 等位基因频率轨迹（N = 50）。*

![序列比对与分析 — Needleman–Wunsch 全局比对](docs/assets/screenshots/plugins/bio-seqalign/nw-global.png)

*序列比对与分析：BLOSUM62 打分的 Needleman–Wunsch 全局比对（identity 46.4%）。*

![蛋白质相互作用 — 残基相互作用网络](docs/assets/screenshots/plugins/protein-network.png)

*蛋白质相互作用：残基相互作用网络图。*

**医学与公共卫生**

![传染病分室模型 — SEIR 流行曲线](docs/assets/screenshots/plugins/bio-epidemic/seir.png)

*传染病分室模型：SEIR 仓室流行曲线（N = 10⁵，R₀ = 2.8）。*

![药代动力学室分析 — 二室药时曲线与治疗窗](docs/assets/screenshots/plugins/bio-pk.png)

*药代动力学室分析：二室药时曲线与治疗窗叠加。*

**地理**

![投影变形（Tissot 圆）— 摩尔威德投影上的变形圆](docs/assets/screenshots/plugins/tissot-mollweide.png)

*投影变形（Tissot 圆）：摩尔威德等积投影上的 Tissot 变形圆。*

![太阳高度与昼夜长短 — 年变化曲线](docs/assets/screenshots/plugins/geo-solar.png)

*太阳高度与昼夜长短：正午太阳高度与昼长的年变化。*

![距离与面积量算 — 城市间距离与面积](docs/assets/screenshots/plugins/geo-measure.png)

*距离与面积量算：城市间大圆距离与封闭区域面积。*

![气候直方图 — 开罗逐月降水柱与气温折线](docs/assets/screenshots/plugins/climatograph-cairo.png)

*气候直方图：开罗逐月降水柱与气温折线。*

![放射性碳定年实验室 — 校准曲线与概率分布](docs/assets/screenshots/plugins/geo-carbondating.png)

*放射性碳定年实验室：校准曲线与概率分布。*

![土壤水分特征曲线拟合 — van Genuchten 持水拟合](docs/assets/screenshots/plugins/geo-soilwater.png)

*土壤水分特征曲线拟合：van Genuchten 持水曲线拟合。*

![SCS 降雨径流模型 — 降雨-径流水文图](docs/assets/screenshots/plugins/geo-hydrology.png)

*SCS 降雨径流模型：降雨-径流水文图。*

**环境学**

![捕食者-猎物（Lotka–Volterra）— 相轨线与振荡](docs/assets/screenshots/plugins/env-predator-prey.png)

*捕食者-猎物（Lotka–Volterra）：相轨线与种群振荡。*

![温室效应模拟 — 零维能量平衡与 ΔT](docs/assets/screenshots/plugins/env-greenhouse.png)

*温室效应模拟：零维辐射收支平衡与温升 ΔT。*

![碳循环推演 — 箱式模型百年演化](docs/assets/screenshots/plugins/env-carbon.png)

*碳循环推演：四碳库箱式模型的百年演化。*

![空气质量评价（AQI）— 分日 AQI 柱状图](docs/assets/screenshots/plugins/env-aqi.png)

*空气质量评价（AQI）：分日 AQI 柱状图，峰值 116。*

![水质评价 — 雷达图与 WQI 评级](docs/assets/screenshots/plugins/env-water.png)

*水质评价：四站点雷达图与 WQI 评级。*

![生物多样性指数 — 丰度堆叠与多样性指数](docs/assets/screenshots/plugins/env-biodiversity.png)

*生物多样性指数：三样点物种丰度堆叠与多样性指数。*

![污染物扩散模拟 — 高斯烟羽地面浓度](docs/assets/screenshots/plugins/env-plume.png)

*污染物扩散模拟：高斯烟羽地面浓度。*

![3D 全球环境 — 三维地球反照率图层](docs/assets/screenshots/plugins/env-earth3d.png)

*3D 全球环境：三维地球反照率图层。*

**天文**

![天文 CCD 管线 — 模拟星场与源检测圈](docs/assets/screenshots/plugins/astro-pipeline.png)

*天文 CCD 管线：CCD 模拟星场与源检测圈。*

![凌星系外行星光变拟合 — 梯形模型与相位折叠](docs/assets/screenshots/plugins/astro-transit.png)

*凌星系外行星光变拟合：梯形模型拟合相位折叠光变曲线。*

![赫罗图 — 恒星散点与主序参考线](docs/assets/screenshots/plugins/astro-hrdiagram.png)

*赫罗图：恒星散点与主序参考线。*

**材料学**

![XRD 衍射图谱分析 — 硅衍射峰谱与 d 值标注](docs/assets/screenshots/plugins/mats-xrd.png)

*XRD 衍射图谱分析：硅衍射峰谱与 d 值标注。*

![热分析（DSC/TGA）— 失重台阶曲线](docs/assets/screenshots/plugins/mats-thermal.png)

*热分析（DSC/TGA）：失重台阶曲线。*

**工程仿真**

![平面桁架有限元分析 — 轴力着色与变形叠加](docs/assets/screenshots/plugins/eng-truss.png)

*平面桁架有限元分析：轴力着色与变形形状叠加。*

![直流电路节点分析 — 电路拓扑上的节点电压](docs/assets/screenshots/plugins/eng-circuit.png)

*直流电路节点分析：电路拓扑上的节点电压。*

![控制系统实验室 — 阶跃响应与 Bode 图](docs/assets/screenshots/plugins/eng-control.png)

*控制系统实验室：阶跃响应与 Bode 图。*

**经济与金融**

![Black-Scholes 期权定价实验室 — 价格曲线与蒙特卡洛收敛](docs/assets/screenshots/plugins/econ-blackscholes.png)

*Black-Scholes 期权定价实验室：解析价格曲线与蒙特卡洛收敛。*

![空间囚徒困境演化博弈 — 策略网格与合作率](docs/assets/screenshots/plugins/econ-evogame.png)

*空间囚徒困境演化博弈：策略网格与合作率。*

**心理与行为**

![简单反应时实验室 — 反应时序列与直方图、箱线图](docs/assets/screenshots/plugins/psych-rt.png)

*简单反应时实验室：反应时序列与直方图、箱线图。*

**数据与智能**

![图像处理 — 锐化前后对比](docs/assets/screenshots/plugins/data-imageproc.png)

*图像处理：锐化前后对比。*

**特效渲染**

![黑洞 · 3D 光线追踪 — 引力透镜与吸积盘](docs/assets/screenshots/plugins/fx-blackhole.png)

*黑洞 · 3D 光线追踪：逐像素测地线引力透镜与多普勒集束吸积盘。*

![星空 · 夜天渲染器 — 银河星场](docs/assets/screenshots/plugins/fx-stars.png)

*星空 · 夜天渲染器：程序化银河星场。*

![水波 · 3D 流体 — 波动网格涟漪](docs/assets/screenshots/plugins/fx-water.png)

*水波 · 3D 流体：三维场景中的动态波动网格涟漪。*

**趣味工具**

![配色探索器 — 12 色阶渐变色卡](docs/assets/screenshots/plugins/fun-palette.png)

*配色探索器：12 色阶渐变色卡。*

![科赫雪花 — 迭代 6 层](docs/assets/screenshots/plugins/fun-koch.png)

*科赫雪花：迭代 6 层。*

![巴恩斯利蕨 — 30 万点](docs/assets/screenshots/plugins/fun-barnsley.png)

*巴恩斯利蕨：30 万点。*

![谐振记录仪 — 缠绕的衰减摆线](docs/assets/screenshots/plugins/fun-harmonograph.png)

*谐振记录仪：缠绕的衰减摆线。*

当 WebGPU 缺失时，每个内置插件都在 CPU 上运行相同数学——完整计算路径见 [GPU 计算与原生核心](#gpu-计算与原生核心)。

### 第三方包（`.cspkg`）

包是含 `manifest.json` + 入口 + 资源的 ZIP，加载时校验清单（id 格式、入口路径穿越、沙箱枚举）后执行：

```jsonc
{
  "id": "com.example.analyzer",
  "name": "Analyzer",
  "version": "1.2.0",
  "entry": "dist/index.js",
  "sandbox": "isolated",        // "isolated"（默认，Worker 中运行，无 DOM）| "trusted"（完整 DOM 访问）
  "formats": [{ "extension": ".dat" }]
}
```

- `sandbox: "isolated"`（默认）——Worker 内独立全局作用域，canvas 经 OffscreenCanvas 渲染。
- `sandbox: "trusted"`——宿主上下文中执行，仅对自己控制的包使用。

**限制（如实记录）**：Worker 共享同源 IndexedDB，且 `new Function` 回退只是尽力而为的近似、**并非**安全边界，启用时会告警。

---

## GPU 计算与原生核心

Rust crate `native/ergalics-core`（设备管理、计算内核调度、魔数文件检测）为**源码交付**：可编译至 `wasm32-unknown-unknown` 并经 wasm-bindgen 绑定。发行构建不包含编译后的 WASM——`npm run build:web` 注入生成的 WASM stub（`scripts/make-wasm-stub.mjs`），运行时全部计算路径回退到浏览器原生 WebGPU / CPU 实现。

WebGPU 计算管线本身真实存在并被插件实际使用：

- `src/core/gpu.ts` 拥有适配器/设备生命周期，WebGPU 不可用时回退 CPU。
- `src/core/compute.ts` 暴露**面向插件的计算面**（`PluginApi.gpu`）：`createBuffer` / `write` / `read`、`compileKernel`，以及一次性 `run`。
- **14 个可复用 WGSL 内核**位于 `src/core/wgsl.ts`：粒子积分、3D 全对 N 体、直方图、热力图、点云投影、D2Q9 LBM collide / stream / curl、二维波动方程 leapfrog、矩阵乘法、基 2 FFT、k-means、分箱与稀疏 SpMV——每个内核都配有 CPU 路径的宿主侧打包/解包辅助。Particles 演示单缓冲路径，N-Body 使用乒乓缓冲让每个积分步留在设备上。

> 当 WebGPU 不可用时，`api.gpu` 为 `undefined`，插件回退到 CPU——行为一致，无需 GPU。

---

## 测试

单元测试（Vitest，node 环境）：

```bash
npm test          # 或 npm run test:unit
npm run verify    # 类型检查 + 单元测试
```

**3260 个测试分布在 204 个测试文件中**，覆盖：数据与 I/O、统计内核、插件与沙箱、环境学与生物学插件套件、GPU 计算、Git 适配器与项目同步、工作区 VFS、科研级科学输出总线、区块系统、三模式 IR 同步（积木 ↔ 流程 ↔ 代码往返）、科研模块（不确定性 / 单位 / 实验记录 / 血缘 / 图表 / 打包 / Notebook / 模型 / 画像 / 信号 / 扫描 / SQL / 报告 / 可复现锁 / 推断引擎）、可靠性内核、平台。

E2E 套件（Playwright-core, headless Edge）：

```bash
npm run test:e2e
```

`scripts/e2e-run.mjs` 按序运行 11 个脚本（可用 `--parallel <n>` 并行）：`smoke-test`、`verify-ui`、`verify-fixes`、`verify-3d`、`verify-plugins`、`verify-webgpu`、`verify-block-mode`、`verify-code-mode`、`verify-ai-samples`、`verify-ai-training`、`verify-research`。另有 3 个单独运行：`verify-lang-modes`（R/JS 在 IR 引擎上运行与跨模式切换）、`verify-r-runtime`（内置 webR 完整 R 路径）与 `npm run verify:site`（合并部署三界面路径完整性）——共 14 个 E2E 脚本。

CI 由 5 条 GitHub Actions 工作流组成：`ci`、`bench`、`deploy`、`release` 与 `security`。性能基准位于顶层 `bench/` 目录——`npm run bench` 运行、比对并输出报告（`bench:ci` 供 CI 基线使用，`bench:update` 刷新基线文件）。

---

## 文档

三个 Web 界面统一部署到同一 GitHub Pages 站点：

- **官方网站**（`website/`）位于 Pages 根——画廊、主题市场与插件市场，零安装深链。
- **工作站**（React 应用）位于 `<repo>/app/`——"在线工作站"入口，内嵌文档副本。
- **文档**——独立 VitePress workspace 位于 [`docs/`](docs/)：

```bash
cd docs && npm install && npm run dev    # 本地文档站点
npm run build                            # 静态站点 → docs/.vitepress/dist
```

`deploy.yml` 用 `scripts/merge-deploy.mjs` 合并三者；`npm run verify:site` 在发布前探测三个关键路径，跨站导航回归会在 CI 中报错而非静默失效。

---

## 路线图

要点（完整状态见 [`docs/guide/roadmap.md`](docs/guide/roadmap.md)）：

- [x] 工作台布局、项目管理、文件路由；四种模式（标准 / 流程 / 积木 / 代码）
- [x] 工作台文件资源管理器 + 标签页中央区 + 按文件分派的编辑器（`.py` / `*.flow.json` / `*.block.json`）、中央导出菜单、工作区产物
- [x] 158 个内置插件（148 科学自动加载 + 10 趣味手动加载）按 19 学科分组、cspkg 加载、Worker 沙箱、Ed25519 签名门禁（FR-05）
- [x] 插件 CSV 导出按钮 + 分析叠加层；中央画布导出菜单（PNG / 透明 PNG，保存到工作区）；市场目录
- [x] WebGPU 设备管理 + 14 个可复用 WGSL 内核（Particles / N-Body / LBM / 波动方程 / FFT / k-means…）
- [x] 地理插件系列（空间插值含 LOOCV + Moran's I、地形分析流域三件套、FAO-56 等），全部支持发送 Figure Studio
- [x] 地球科学插件系列（地震波传播 / 矿物鉴定 / 水文地质），带 Ed25519 钉扎清单签名与科研基准
- [x] 环境学插件系列（空气质量 / 水质 / 碳循环 / 生物多样性 / 高斯烟羽 / 温室效应 / 3D 全球环境）
- [x] 全部科研级插件套件（物理 / 化学 / 生物 / 环境 / 地理 / 数学 / 统计 / 经济 / 心理 / 天文 / 数据 / 工程 + 两个求解器）接入发送 Figure Studio 联动
- [x] 科研级插件元数据（四级徽章）+ 统一科学输出栏
- [x] Git 仓库化项目——适配器、项目 store 同步与 Git 面板（分支 / 提交 / 克隆 / 远程同步 / 自动提交 / 预装钩子 / CI 模板；diff 查看器与冲突向导待做）
- [x] 流程模式（编译器 + 增量执行器 + 57 个区块）、积木模式（Blockly 13 + 共享 IR，5 个示例）、代码模式（Python / R / JavaScript，预览窗互译）
- [x] 三语言无缝往返（共享 IR 中枢，`mergeFlowIR` + 签名守卫，测试固化）
- [x] 统计分析子系统（`src/core/stats/`）、科研二进制导入（`src/core/io/`）、出版级绘图引擎（`src/core/plot/`）、可复现性内核
- [x] 26 个独立科研工具分 6 组（含免项目的 utils 小工具组），支持内嵌到工作台画布
- [x] 研究级可靠性层（错误分类法 + 校验框架 + 数据质量引擎）
- [x] AI 助手（自然语言 → `studio.*` 代码草稿 → 运行；离线 / 在线两种模式）
- [x] 完整自由语法 R 运行时（webR + CRAN 包，缺失时回退 IR 引擎）
- [x] 官方网站（画廊 / 主题市场 / 插件市场）+ 官网市场"下载"产出可加载 `.cspkg`
- [x] 5 条 GitHub Actions 工作流（ci / bench / deploy / release / security）
- [ ] 插件市场：第三方自助提交与安装管线

---

## 贡献

1. Fork 并创建功能分支。
2. 保持改动小巧且由测试覆盖——`npm run verify` 必须保持绿色；新插件/功能应附带 E2E 检查。
3. 提交 PR 前运行 `npm run test:e2e`。
4. 触碰 `native/ergalics-core` 后用 `npm run build:wasm` 重新生成 WASM 绑定。

通过 [GitHub Issues](https://github.com/SnowLeopard-io/ErgalicsStudio/issues) 报告 bug 与功能请求。

---

## 许可证

[MIT](LICENSE) © 2026 [SnowLeopard-io](https://github.com/SnowLeopard-io)
