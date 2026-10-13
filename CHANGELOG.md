# Changelog

Ergalics Studio 的所有显著变更都记录在此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。

All notable changes to Ergalics Studio are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/lang/zh-CN/).

`1.0.0` 对应 **SDK v1 契约冻结**（提交 `c7b7327`，2026-09-12）。此前均为 v0 实验期，与插件 SDK 迁移指南中的「实验期 v0 → SDK v1」阶段划分一致。

`1.0.0` corresponds to the **SDK v1 contract freeze** (commit `c7b7327`, 2026-09-12). Everything before it belongs to the v0 experimental period, consistent with the "experimental v0 → SDK v1" phase division in the plugin SDK migration guide.

## [Unreleased] / 未发布

- 工作台模块化外壳：左侧活动栏在文件 / Git / 插件三个视图间切换（侧栏可调宽、可收起），中央标签区让插件画布、文件预览、按文件分派的编辑器与内嵌科研工具以标签页共存

- Modular workbench shell: the left activity bar switches among the File / Git / Plugins views (the sidebar is resizable and collapsible), and the central tab area lets plugin canvases, file previews, per-file editors, and embedded research tools coexist as tabs

- 新增第 20 个科研工具「文件资源管理器」：经免 Git 的 VFS 浏览项目工作区，文本预览与下载，附标准项目骨架目录指南；科研工具默认以 ToolShell 嵌入工作台中央区打开

- Added the 20th research tool "File Explorer": browse the project workspace through a Git-free VFS, with text preview and download, plus a directory guide for the standard project skeleton; research tools now open by default embedded via ToolShell in the workbench central area

- 新增工作区文件系统（`src/core/vfs`，LightningFS / IndexedDB 存储）与 Git 适配器（`src/core/git`，自动提交）

- Added a workspace file system (`src/core/vfs`, LightningFS / IndexedDB storage) and a Git adapter (`src/core/git`, auto commit)

- 流程图与积木程序持久化为工作区文件 `.flow.json` / `.block.json`，旧的 `blockGraph` 项目字段兼容读取

- Flowcharts and block programs are persisted as workspace files `.flow.json` / `.block.json`, with backward-compatible reading of the legacy `blockGraph` project field

- 画布级统一「导出」菜单（PNG 下载 / 存工作区 `figures/`，3D 场景透明背景），取代各插件独立的快照按钮；数据级 CSV 导出改为插件自声明的 `exportCsv` 动作

- A unified canvas-level "Export" menu (PNG download / save to workspace `figures/`, transparent background for 3D scenes) replaces the per-plugin snapshot buttons; data-level CSV export moves to the plugin-declared `exportCsv` action

- 顶栏重构：项目名下拉集中最近项目与新建 / 打开 / 导出日志等动作，数据簇带项目文件数徽标，科研启动器支持最近使用 / 学科分组 / 搜索过滤，全局图标簇窄屏折叠进 ⋯ 溢出菜单；新增命令面板（Ctrl+K）与快捷键帮助

- Top bar rework: the project name dropdown concentrates recent projects and actions such as New / Open / Export Log, the data cluster carries a project file count badge, the research launcher supports recent use / discipline grouping / search filtering, and the global icon cluster collapses into the ⋯ overflow menu on narrow screens; adds a command palette (Ctrl+K) and keyboard shortcut help

- 新增环境学科插件组（7 个：空气质量指数、水质判别、温室效应、碳循环、生物多样性指数、污染物扩散、三维全球环境），内置插件总数 59 → 66（56 自动加载 + 10 按需）

- Added an environmental-science plugin group (7 plugins: Air Quality Index, Water Quality Assessment, Greenhouse Effect, Carbon Cycle, Biodiversity Index, Pollutant Diffusion, 3D Global Environment); the total number of built-in plugins grows 59 → 66 (56 auto-loaded + 10 on demand)

- 新增领域子系统：chem（键能 / ΔG°(T) / Arrhenius）、geo（球面几何与地形网格）、markdown（mermaid + KaTeX 增强）、plugin-tools（插件面板工具）、research（统一科研输出总线），`src/core` 子系统目录 34 → 40

- Added domain subsystems: chem (bond energy / ΔG°(T) / Arrhenius), geo (spherical geometry and terrain meshes), markdown (mermaid + KaTeX enhancements), plugin-tools (plugin panel tools), and research (a unified research output bus); the `src/core` subsystem directory grows 34 → 40

- 状态库新增 commandPaletteStore 与 shortcutsStore（共 19 个状态文件）；流程区块目录 40+ → 42 个（`plot.*` 产出可导出 SVG / PDF 的出版级矢量图）；积木 40 种；示例项目拆分为 8 个流程示例 + 3 个插件演示

- The state store adds commandPaletteStore and shortcutsStore (19 state files in total); the flow block catalog grows 40+ → 42 (`plot.*` produces publication-grade vector figures exportable as SVG / PDF); 40 block types; sample projects are split into 8 flow examples + 3 plugin demos

- 开源社区文档（CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG / PR 与 Issue 模板）完成中英双语化：中文段在前、对应英文段紧随、一一对应交替；README 维持英文单文件 + 中文单文件的标准双语体系

- The open-source community docs (CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG / PR and issue templates) are now bilingual: each Chinese paragraph is followed by its English counterpart, alternating one-to-one; the README keeps the standard English-file + Chinese-file pair

- 依赖安全台账清零（`npm audit` 零发现，详见 SECURITY.md 2026-10-13 升级窗口）：docs 工作区迁移 vitepress@2.0.0-alpha.6，vite / esbuild 收敛为全树单一已修复节点，并修复该文档中两处 v1 时代截图死链；`argparse` 经 `overrides` 钉至 2.0.1，移除无上游补丁的 sprintf-js 传递链；mermaid 12.2.0 修复其 katex 传递依赖的原型污染；移除未使用的 uuid / @types/uuid / @types/katex / @types/lz-string

- The dependency-security ledger is cleared (`npm audit` reports zero findings, see the SECURITY.md 2026-10-13 upgrade window): the docs workspace moves to vitepress@2.0.0-alpha.6 so vite / esbuild collapse into a single patched node tree-wide, and two v1-era dead screenshot paths in that doc are fixed; `argparse` is pinned to 2.0.1 via `overrides`, removing the sprintf-js transitive chain that has no upstream patch; mermaid 12.2.0 fixes a prototype-pollution advisory in its katex transitive dependency; unused uuid / @types/uuid / @types/katex / @types/lz-string are removed

## [v1.9.0] - 2026-09-24 发布前校准 / Pre-release calibration

- 文档基线校准：内置插件 59 个（49 科学 + 10 趣味）、单元测试文件 123 个、用例 2233 个；补充 R 代码模式优先使用内置 webR 完整运行时的说明

- Documentation baseline calibration: 59 built-in plugins (49 science + 10 fun), 123 unit test files, and 2233 test cases; added a note that the R code mode prefers the built-in full webR runtime

- 新增稀疏矩阵-向量乘（SpMV）WGSL 内核

- Added a sparse matrix-vector multiplication (SpMV) WGSL kernel

- 插件分组与科研工具描述同步更新

- Plugin groupings and research tool descriptions updated in sync

## [v1.8.0] - 2026-09-23 插件生态扩展 / Plugin ecosystem expansion

- 新增 10 个科研级地理插件：太阳高度与昼长、气候图、人口金字塔、空间插值、测距测面、投影变形、地形分析（3D 网格视图）、GPX 轨迹分析等

- Added 10 research-grade geography plugins: Solar Altitude and Day Length, Climograph, Population Pyramid, Spatial Interpolation, Distance and Area Measurement, Projection Distortion, Terrain Analysis (3D mesh view), GPX Track Analysis, and more

- 新增生物学插件套件：酶动力学、传染病模型、序列比对（FASTA/JSON/CSV）、群体遗传学（VCF/基因型计数）

- Added a biology plugin suite: enzyme kinetics, epidemic models, sequence alignment (FASTA/JSON/CSV), and population genetics (VCF / genotype counts)

- 化学反应插件：新增 10 个常见有机反应示例及热力学参数；晶胞按边框裁剪边界视图；自由投料反应模式

- Chemistry reaction plugins: added 10 common organic reaction examples with thermodynamic parameters; unit cells clip the boundary view by their frame; free-feeding reaction mode

- 晶体系统：新增真实 CIF 样品（金刚石、石墨、闪锌矿、石英、方解石等），最小镜像距离计算、键推断与范德华半径空间填充模型

- Crystal system: added real CIF samples (diamond, graphite, zinc blende, quartz, calcite, etc.), minimum image distance computation, bond inference, and van der Waals radius space-filling models

- 3D 场景透明背景导出（点云/体素/曲面/N体/晶体/化学反应）

- Transparent-background export for 3D scenes (point cloud / voxel / surface / N-body / crystal / chemical reaction)

- 地理插件一键发送 Figure Studio 组装多面板图组

- Geography plugins can send figures to Figure Studio in one click to assemble multi-panel figure groups

- 文件导入同名数据替换确认；3D 场景切换对象清理修复

- Confirmation when importing data that replaces an existing same-name dataset; fixed object cleanup when switching 3D scenes

## [v1.7.0] - 2026-09-22 webR 完整 R 运行时 + 化学插件 / Full webR R runtime + chemistry plugins

- webR 更新至 0.6.0 并完整内置（`public/webr/`）：R 代码模式默认优先启动真实 webR 解释器，缺失时无缝回退到内置 IR 引擎

- webR updated to 0.6.0 and fully bundled (`public/webr/`): the R code mode starts the real webR interpreter by default, seamlessly falling back to the built-in IR engine when it is missing

- 新增化学晶胞（CIF/对称展开，含 NaCl 示例）与反应分子动力学插件

- Added chemical unit cell (CIF / symmetry expansion, with an NaCl example) and reaction molecular dynamics plugins

- 移除废弃的 studio 调用转发逻辑，修复 R 代码解析测试

- Removed the deprecated studio call forwarding logic and fixed the R code parsing tests

## [v1.6.0] - 2026-09-21 流体 CFD 双向耦合求解器 / Fluid CFD two-way coupling solver

- 完整实现 1D 管网与 3D 场双向耦合求解器（重命名自 `em-cfd-coupler`）

- Fully implemented a two-way coupling solver for 1D pipe networks and 3D fields (renamed from `em-cfd-coupler`)

- 纯 Python 数值内核（仅依赖 numpy），支持 CLI 与 Pyodide 浏览器运行

- Pure Python numerical kernel (depending only on numpy), runnable via CLI and in-browser through Pyodide

- 多速率时间子循环协调、双向边界耦合与守恒审计、毫秒级阀门控制、精度-效率权衡曲线

- Multi-rate time subcycling coordination, two-way boundary coupling with conservation auditing, millisecond-level valve control, and accuracy-efficiency trade-off curves

- 3D 场体素可视化、一键发送 Figure Studio、「运行全部」一键执行验证与耦合

- Voxel visualization of the 3D field, one-click send to Figure Studio, and a "Run All" one-click execution of verification and coupling

- 拆分插件清单为独立文件，减小首屏打包体积

- Split the plugin manifest into separate files to reduce the first-screen bundle size

## [v1.5.0] - 2026-09-20 电磁谐振特征值求解器 / Electromagnetic resonance eigenvalue solver

- 新增电磁本征求解器插件：Lanczos/LOBPCG/Jacobi-Davidson 算法、WebGPU SpMV 内核与 CPU 多线程 matvec 加速

- Added an electromagnetic eigenvalue solver plugin: Lanczos/LOBPCG/Jacobi-Davidson algorithms, a WebGPU SpMV kernel, and CPU multi-threaded matvec acceleration

- 3D 模式场可视化（场分布图/3D 曲面）、峰值标注、发散色标与导出到 Figure Studio

- Field visualization in 3D mode (field distribution maps / 3D surfaces), peak annotation, diverging color scales, and export to Figure Studio

- 非有限值（NaN/Inf）检测、插件重载自恢复、参数扫描诊断、可复现凭证与诊断报告

- Non-finite value (NaN/Inf) detection, self-recovery on plugin reload, parameter sweep diagnostics, reproducibility credentials, and diagnostic reports

- 新增 `.mtx/.npz/.npy/.geojson` 数据格式；同名文件替换提示

- Added `.mtx/.npz/.npy/.geojson` data formats; prompt when a same-name file is about to be replaced

- 官网下载页与多格式技术文档下载支持

- Official website download page and multi-format technical documentation downloads

## [v1.4.0] - 2026-09-18 AI 助手 + 官方网站打通 / AI assistant + official website integration

- 全局悬浮 AI 助手面板（项目级，各工作台模式可用）

- Global floating AI assistant panel (project-level, available in all workbench modes)

- 插件市场 `.cspkg` 真实可加载打包与安装：签名逻辑、安装后自动激活、ID 冲突检测

- Real loadable `.cspkg` packaging and installation for the plugin market: signing logic, automatic activation after install, and ID conflict detection

- 官方网站项目（画廊/主题市场/插件市场）+ 跨站深链直达工作台

- Official website project (gallery / theme market / plugin market) + cross-site deep links straight into the workbench

- PWA 支持、主题系统、性能监控、WCAG 配色

- PWA support, a theme system, performance monitoring, and WCAG-compliant color schemes

- 插件开发脚手架模板与文档；课程模式重做（身份验证二步流）

- Plugin development scaffold templates and documentation; course mode rework (two-step authentication flow)

## [v1.3.0] - 2026-09-17 统一架构与可靠性层 / Unified architecture and reliability layer

- 统一 ToolShell：全部科研工具迁移到 `/studio/:toolId` 路由，共用工具外壳与最近使用记录

- Unified ToolShell: all research tools migrate to the `/studio/:toolId` route, sharing the tool shell and recent-use records

- 错误处理重构：统一错误注册表、`Result` 类型、断言守卫、重试机制

- Error handling rework: a unified error registry, the `Result` type, assertion guards, and retry mechanisms

- 可组合字段路径校验框架、Pandera 风格数据质量引擎（类型推断与坏行隔离）

- A composable field path validation framework and a Pandera-style data quality engine (type inference and bad row isolation)

- 代码模式：多语言切换互译、Flow DAG ↔ IR 双向转换与合并、函数/空值/循环控制积木块

- Code mode: interconversion across the language modes, bidirectional Flow DAG ↔ IR conversion and merging, and function / null / loop control blocks

- 解析器支持分类/数值混合列；应用版本号注入运行环境

- The parser supports categorical/numeric mixed columns; the application version number is injected into the runtime environment

## [v1.2.0] - 2026-09-16 第二代科研平台 / Second-generation research platform

- Inference Forge：HMC/NUTS 贝叶斯推断（声明式概率模板、WAIC/LOO/PPC、后验轨迹与密度图）

- Inference Forge: HMC/NUTS Bayesian inference (declarative probability templates, WAIC/LOO/PPC, posterior traces and density plots)

- SQL 工作台（DuckDB-WASM）、信号实验室（FFT/PSD/滤波/ACF-PACF/季节分解）

- SQL workbench (DuckDB-WASM) and Signal Lab (FFT/PSD/filtering/ACF-PACF/seasonal decomposition)

- 模型实验室（OLS/逻辑/岭/多项式回归）、数据画像、Sweep 参数扫描、可复现锁（`repro.lock`）

- Model Lab (OLS / logistic / ridge / polynomial regression), data profiling, Sweep parameter scanning, and a reproducibility lock (`repro.lock`)

- 报告生成器（自包含交互式 HTML）、数据血缘（lineage）画布

- Report generator (self-contained interactive HTML) and a data lineage canvas

- GPU 不确定性引擎（WGSL PCG32、GPU bootstrap/MCMC、R-hat + ESS 诊断）

- GPU uncertainty engine (WGSL PCG32, GPU bootstrap/MCMC, R-hat + ESS diagnostics)

- 科研工具升级为独立整页应用，共享统一实验室外壳

- Research tools upgraded to standalone full-page applications sharing a unified lab shell

## [v1.1.0] - 2026-09-13 交互式物理实验室 / Interactive physics laboratory

- 三大旗舰物理实验室插件：电磁场（库仑力/洛伦兹力）、光学（光线追踪/色散）、结构力学（桁架承重/杆件断裂）

- Three flagship physics lab plugins: electromagnetics (Coulomb force / Lorentz force), optics (ray tracing / dispersion), and structural mechanics (truss loading / member fracture)

- 新增 apache-arrow 依赖，增强 Parquet 数据处理

- Added the apache-arrow dependency to enhance Parquet data processing

- 新手引导、示例对话框分组展示、文档技术总结

- Onboarding tutorial, grouped display in the examples dialog, and a technical summary in the documentation

## [v1.0.0] - 2026-09-12 SDK v1 契约冻结 / SDK v1 contract freeze

- 插件 SDK v1 冻结：扩展 `api.log` / `api.cache` / `api.exportFile`，`manifest.signature`（Ed25519，FR-05）、`PluginRunRecord`/`ParameterSnapshot` 观测记录

- Plugin SDK v1 frozen: extended `api.log` / `api.cache` / `api.exportFile`, `manifest.signature` (Ed25519, FR-05), and `PluginRunRecord`/`ParameterSnapshot` observation records

- 插件缓存系统、项目生命周期钩子、运行日志导出

- Plugin cache system, project lifecycle hooks, and run log export

- 插件沙箱与 worker 通信重构（嵌套 API 调用）、局部导入与销毁流程优化

- Reworked plugin sandbox and worker communication (nested API calls); optimized partial import and disposal flows

- 多插件运行时修复：数据加载停止运行、N体 CPU 积分、LBM 流体吸收层/自动恢复、取消滞后修复

- Runtime fixes across plugins: stopping a run during data loading, N-body CPU integration, LBM fluid absorbing layers / auto recovery, and a cancellation lag fix

## [v0.6.0] - 2026-09-06 物理地理插件与原生 Python / Physics and geography plugins and native Python

- 流体 LBM、波动方程、双摆、GeoJSON 地图等物理/地理插件

- Physics/geography plugins such as fluid LBM, the wave equation, the double pendulum, and GeoJSON maps

- 数据分析面板；自托管 Pyodide 运行时（移除 CDN 依赖）

- Data analysis panel; self-hosted Pyodide runtime (CDN dependency removed)

- 插件侧边栏按学科分组折叠；IR 新增原始表达式节点

- The plugin sidebar collapses by discipline grouping; IR adds a raw expression node

- Blockly 媒体资源本地托管

- Blockly media assets hosted locally

## [v0.5.0] - 2026-09-05 第一代科研内核 / First-generation research kernel

- 统计分析子系统：特殊函数库、描述性统计、假设检验、效应量、多重比较校正

- Statistical analysis subsystem: special function library, descriptive statistics, hypothesis testing, effect sizes, and multiple comparison corrections

- 科研二进制导入：HDF5 / Parquet / FITS / NetCDF / Zarr

- Scientific binary import: HDF5 / Parquet / FITS / NetCDF / Zarr

- 纯 TS 矢量绘图引擎（SVG/PDF 出版级导出）与可复现性模块（确定性 RNG、运行清单）

- Pure TS vector plotting engine (SVG/PDF publication-grade export) and a reproducibility module (deterministic RNG, run manifests)

- 鲁棒性修复：编辑器无限重渲染、BOM 剥离、3D 资源释放、sandbox/Pyodide 超时

- Robustness fixes: infinite editor re-rendering, BOM stripping, 3D resource disposal, and sandbox/Pyodide timeouts

## [v0.4.0] - 2026-08-20 四模式互转闭环 / Four-mode interconversion closed loop

- 标准 / 流程 / 积木 / 代码四模式经共享 IR 互转完成

- Mutual conversion among the Standard / Flow / Block / Code modes via the shared IR is complete

- 新增简体中文 README

- Added a Simplified Chinese README

## [v0.3.0] - 2026-08-17 代码模式与插件市场 / Code mode and plugin market

- 代码模式（Monaco + Pyodide Python + REPL + 变量面板）

- Code mode (Monaco + Pyodide Python + REPL + variable panel)

- 插件市场（分类筛选、本地化名称、热度排序）、项目文件管理、10 个趣味/实用插件

- Plugin market (category filtering, localized names, popularity sorting), project file management, and 10 fun/utility plugins

- 浏览器内 AI 训练插件（线性回归/神经网络/逻辑回归/MNIST CNN）

- In-browser AI training plugins (linear regression / neural network / logistic regression / MNIST CNN)

- WASM 加载器模块化、CI WebGPU 适配

- Modularized WASM loader and CI WebGPU adaptation

## [v0.2.0] - 2026-08-16 流程与积木模式 / Flow and block modes

- 可视化流程编辑模式（块系统）与积木编程模式（Blockly，中英双语）

- Visual flow editing mode (block system) and block programming mode (Blockly, bilingual Chinese/English)

- 多款可视化插件（柱状/雷达/网络/气泡/小提琴/桑基）与 2D 视口重构

- Multiple visualization plugins (bar / radar / network / bubble / violin / sankey) and a reworked 2D viewport

- 示例工程与示例数据体系

- Sample projects and a sample data system

## [v0.1.0] - 2026-08-14 初始版本搭建 / Initial version setup

- Ergalics Studio 初始可用版本：Rust/WASM 原生核心 + WebGPU 计算

- Initial usable version of Ergalics Studio: Rust/WASM native core + WebGPU computing

- 插件沙箱隔离（Web Worker）、Three.js 3D 场景托管

- Plugin sandbox isolation (Web Worker) and Three.js 3D scene hosting

- 内置插件：散点/等值线/点云/直方图/热力图/图像查看器等

- Built-in plugins: scatter / contour / point cloud / histogram / heatmap / image viewer, etc.

- 首套单元测试与 E2E 基础设施

- First set of unit tests and E2E infrastructure
