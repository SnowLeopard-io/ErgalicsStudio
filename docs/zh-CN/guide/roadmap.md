# 路线图与状态

项目正在**积极开发**——此处标记为**已完成**的每个项目都已进入代码库，并由测试套件覆盖。本表反映实际状态，而非愿景设计。

## 模块状态

| 模块 | 功能 | 状态 |
| --- | --- | --- |
| 欢迎页 | 硬件自检、语言/主题切换、进入工作台 | 已完成 |
| 工作台 | 顶栏 + 活动栏 + 多视图侧边栏（文件 / Git / 插件）、标签式中央区域（插件画布 / 文件预览 / 编辑器 / 嵌入式工具）、文件浏览器 + 文件信息面板、拖放、状态栏 | 已完成 |
| 文件编辑器 | 逐文件编辑器：`.py`/`.js`/`.r` → Monaco，`*.flow.json` → 流程 DAG，`*.block.json` → Blockly；以指定模式打开的桥接、未保存状态、保存回工作区 | 已完成 |
| 工作区 VFS | `src/core/vfs/`——文件浏览器、编辑器与 Git 工作树共享的文件系统，使用 LightningFS（浏览器）/ 内存（Node/测试） | 已完成 |
| Git 支持的项目 | `src/core/git/` 适配器（浏览器使用 isomorphic-git / Node 使用 simple-git）、侧边栏 Git 面板（分支 / 提交 / 克隆 / 拉取-推送-获取、CORS 代理）、自动提交、预装钩子 + CI 模板 | 已完成 |
| 插件系统 | 加载/激活/卸载、注册表、内置插件、cspkg + 沙箱 | 已完成 |
| 项目 | 创建/保存/打开/自动保存/分享 `.clproj` | 已完成 |
| 数据加载 | 文件选择器 / 拖放 / 格式检测 / 路由 | 已完成 |
| 渲染 | 2D 画布 + 宿主 Three.js 场景（惰性创建、管理可见性） | 已完成 |
| 流程模式 | 编译器（校验/拓扑）+ 执行器（增量缓存）+ 53 种内置区块 + 流程画布 + 结果预览 + 示例管线 | 已完成 |
| 积木模式 | 共享 IR + Blockly 13（惰性加载）+ 解释器 + JS / Python 代码生成 + 40 个内置积木 + 5 个示例程序 + 复用流程操作的 `studio.*` API + 通过 `BKY_*` 实现国际化 | 已完成 |
| 国际化 | zh-CN / en-US、检测、响应式切换、Blockly `BKY_*` | 已完成 |
| 主题 | 深色/浅色、跟随系统、CSS 变量 | 已完成 |
| 设置 | 常规 / GPU / 数据 / 关于 | 已完成 |
| 性能监控 | FPS / 帧 / GPU / 内存 / 数据规模及警告 | 已完成 |
| 分享 | 链接生成、项目导出 | 已完成 |
| 原生核心 | 设备管理、`GpuBuffer`、计算内核（编译/绑定组/调度/运行/诊断） | 核心已完成 |
| GPU 计算 | `api.gpu` 计算接口、WGSL 模板、粒子 / 三维 N 体 / LBM 流体 / 波动方程 / 直方图 / 热力图 / 点云内核加速（CPU 回退）、真实设备端到端验证 | 已完成 |
| 统计 | 描述统计、特殊函数、t 检验 / ANOVA / Mann–Whitney / 卡方、效应量、Bonferroni 和 BH 校正、功效分析；以 14 个流程模式 `stats.*` 区块提供 | 已完成 |
| 实验跟踪 | 每个项目的运行记录（IndexedDB `runs` store）、带 A/B 参数差异的运行历史对话框（`src/stores/experimentStore.ts`、`src/core/experiment/record.ts`） | 已完成 |
| 不确定度套件 | bootstrap CI、Monte-Carlo 采样、支持取消的 MCMC（正态似然、无信息先验）——`src/core/uncertainty/` + `/studio/uncertainty` 页面（CPU 或 WGSL GPU 引擎） | 已完成 |
| 单位系统 | 带 SI 解析、量纲代数的类型化 `Quantity` + `units.convert`/`units.check` 区块 + QuantityInput（`src/core/units/`） | 已完成 |
| 数据谱系 | 根据运行记录和数据摄入重建文件→运行 DAG，分层布局（`src/core/lineage/`），LineageCanvas 对话框 | 已完成 |
| 分块摄入 | 面向大型分隔文件的异步行窗口读取器、预览 + 指纹（`src/core/chunked/`） | 已完成 |
| 科研工具集 | `/studio/<id>` 下的 33 个独立工具，分七类（测量与不确定度、模型与推断、数据与图、信号与记录、交付与复现、出版、实用工具；分析页面不在欢迎页启动网格中），也可作为工作台标签页嵌入（`src/pages/research/toolRegistry.ts`） | 已完成 |
| Figure Studio | 基于期刊模板（IEEE/Elsevier）的多面板出版图，SVG/PDF/PNG-600dpi 导出，`/studio/figures` 路由（`src/core/figure/`） | 已完成 |
| 补充材料打包 | 面向论文的 zip，包含 manifest.json（运行记录 + 谱系 + 内容：数据/代码/文件 + 可选的 repro.lock）（`src/core/package/supplement.ts`） | 已完成 |
| 笔记本 | 项目中的混合 Markdown/代码单元、专用 Pyodide 运行时、运行结果进入实验历史——`/studio/notebook` 路由（`src/core/notebook/`） | 已完成 |
| 科学 I/O | 通过单一分发器导入 HDF5 / NetCDF / FITS / Zarr / Parquet（`src/core/io/`） | 已完成 |
| 绘图引擎 | 带比例尺/刻度的纯 TS SVG 渲染器，SVG + PDF 导出（`src/core/plot/`） | 已完成 |
| 可复现性 | 带种子的 RNG、运行清单、DAG 到 Python 导出（`src/core/repro/`） | 已完成 |
| 物理实验室 | 电磁学、光学（含色散的光线追踪）、结构力学（含坍塌的桁架）——交互式、数据驱动 | 已完成 |
| 代码模式 | 现有 IR 上的 Monaco + Pyodide（Python）+ REPL + 9 个示例程序；三模式转换（积木 ↔ 流程 ↔ 代码经 IR）已完成；**R 以完整 webR 运行时提供**（已放入 `public/webr/`，由 `scripts/copy-webr.mjs` 自动复制，缺少该包时回退到 IR 引擎） | 已完成 |
| 科学求解器 | 稀疏厄密特征值求解器（厚重启 Lanczos / LOBPCG / Jacobi-Davidson + MINRES 移位求逆、2D 谱报告 + 3D 模态场）和 1D–3D 流体网络双向耦合器（多速率时间步协调 + 粗细子循环），均在 Pyodide Worker 中运行——`em-eigensolver`、`fluid-cfd-coupler` | 已完成 |
| 插件市场 | 插件注册表 UI 和远程安装；`.cspkg` 包签名门禁（ed25519，FR-05）已上线 | 签名门禁：已完成 · 注册表/安装：下一步 |
| CI | GitHub Actions——5 个工作流：ci / bench / deploy / release / security | 已完成 |
| 错误处理 | 错误边界、回退、重试 | 部分完成 |

## 里程碑

| 里程碑 | 状态 | 已交付 / 剩余工作 |
| --- | --- | --- |
| **M1 — 巩固基础** | 已完成 | 插件生命周期、沙箱和签名门禁、测试套件以及文档站均已落地。 |
| **M2 — 真实 GPU 计算** | 已完成 | 原生核心暴露 `GpuBuffer` + `ComputeKernel::run`，插件 API 提供 `api.gpu` 计算接口，可复用的 WGSL 模板位于 `src/core/wgsl.ts`。GPU 加速现已覆盖 Particles（单缓冲区积分）、N-Body Gravity（三维全对全，使用乒乓缓冲区）、D2Q9 LBM 流体（碰撞 + 迁移）、波动方程蛙跳、直方图 / 热力图 / 点云内核、matmul / FFT / k-means / binning 计算内核，以及稀疏矩阵–向量乘法（SpMV）内核——每个都有相应 CPU 回退。`npm run test:e2e` 在无头 Edge（SwiftShader）中驱动真实 WebGPU 路径：数值测试程序将 GPU 结果与 CPU 积分器比较（误差约在 2e-6 以内），应用集成步骤点击操作 Particles 插件并断言出现 `wasm` 引擎 GPU 提示。剩余后续工作：逐内核 GPU 性能遥测。 |
| **M3 — 代码模式** | 已完成 | Python（Pyodide）已完成——Monaco 编辑器、具有可导入 `studio` 模块的 CPython Worker 运行时、REPL + 变量快照、Worker 中断，以及 `examples/code/` 下的 9 个示例程序。R 也已完成——完整的 webR 运行时已放入 `public/webr/`（由 `scripts/copy-webr.mjs` 自动复制，并由 `verify-r-runtime.mjs` 验证），缺少该包时回退到 IR 引擎。三模式转换（积木 ↔ 流程 ↔ 代码通过共享 IR 往返）已完成，并由 `sync-threeway` 单元测试保证。 |
| **M4 — 插件市场** | 签名门禁已完成 · 注册表/安装为下一步 | 包注册表、版本管理和应用内安装/更新流程。`.cspkg` 包签名门禁（ed25519，FR-05）已随安全工作交付——见 `SECURITY.md`。 |
| **M5 — CI + 发布** | 全部完成 | GitHub Actions 流水线、产物发布，以及部署到 Pages 的文档站（见 `.github/workflows/`）。 |

## 已知限制（如实列出）

| 限制 | 细节 |
| --- | --- |
| 沙箱隔离范围 | 插件沙箱隔离页面上下文（全局变量、DOM、store），但 Worker 共享同源的 IndexedDB——恶意包仍可能读取应用数据。`.cspkg` 包签名门禁（ed25519，FR-05）已上线（见 `SECURITY.md`）；尚缺第三方自助提交与安装流程。 |
| `new Function` 回退 | 旧版回退路径（Worker 不可用时）不是安全边界；使用时 UI 会警告。 |
| WebGPU 可用性 | WebGPU 计算路径需要支持 WebGPU 的浏览器；不支持时应用以 CPU 回退模式运行。 |
| `studio.load` 解析 | 积木 / 代码模式通过项目文件注册表（`setProjectFiles` + `resolveDataFile`）解析 `studio.load(...)`，使项目文件、内置示例和代码模式 `_FILES` 共享同一个加载器。 |
| GPU 区块执行 | 积木模式和 IR 的设计允许日后接入 `gpu.*` 节点族；Worker 侧运行器及从区块调用 `ComputeKernel` 调度尚未接通。 |
