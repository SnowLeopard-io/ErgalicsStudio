# Ergalics Studio

Ergalics Studio is a scientific computing workstation that runs entirely in the browser: no installation, ready on opening, with data stored locally. Four working modes share the same data, allowing a continuous workflow from viewing plots and building flows to writing code without changing tools, and enabling delivery of reproducible research results.

> This is the complete technical summary of Ergalics Studio, covering system architecture, plugins, four working modes, research tools, the GPU compute engine and testing and quality assurance, with a user guide and document index. The numerical baseline is 107 built-in plugins, 38 Flow blocks, 26 research tools, 43 domain subsystems, 173 test files / 2,815 unit tests (2,813 passed + 2 skipped), 14 end-to-end suites (1 smoke + 13 verify), and 5 CI workflows.

## Chapter 1. Project overview {#第一章-项目概览}

### 1.1 Project overview {#_1-1-项目概览}

- **A full-stack scientific computing workbench with zero browser-side installation.** From dragging in a CSV to view a plot, building dataflow pipelines, and assembling blocks to writing Python / R / JavaScript, the entire workflow runs in the web page and supports offline use.
- **Local-first; data stays on the machine.** Projects and data live in browser IndexedDB / OPFS and can be exported as `.clproj` files for offline exchange; there is no cloud copy. A project is also a Git repository, with its version history kept locally.
- **MIT open source.** All source code, 173 test files, and 5 CI workflows are publicly accessible; releases are archived through Zenodo and assigned a DOI.

| Area | Current state |
| --- | --- |
| Built-in plugins | 107 (97 automatically loaded at startup, 10 fun tools loaded on demand), grouped into 16 disciplines |
| Research tools | 26, organized into six groups: measurement and evaluation, modeling and inference, data and lineage, signals and records, reporting and reproduction, and toolbox |
| Flow blocks | 38, covering eight categories: data sources, transforms, filters, math, statistics, units, visualization, and plotting |
| Working modes | Four modes: Standard / Flow / Block / Code; the three scripted modes share one intermediate representation (IR) |
| GPU kernels | 14 reusable WGSL compute kernels, each with a mathematically consistent CPU implementation |
| Competition-grade solvers | 2: a sparse Hermitian eigensolver for matrices of order 100,000, and a 1D pipe-network–3D field bidirectional coupling solver |
| Tests and CI | 2,815 unit tests, 14 end-to-end suites, and 5 CI workflows |

![Electromagnetic resonance eigensolver: 3D mode field of a microwave cavity](../assets/screenshots/plugins/em-eigensolver/mode3d-cavity.png)

*Electromagnetic resonance eigensolver: three kernels solve sparse Hermitian eigenpairs of order 100,000 and certify true residuals; the image shows a microwave cavity's 3D mode field.*

![1D–3D bidirectional coupling solver: coupled field voxels (Case A)](../assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-a.png)

*1D–3D bidirectional coupling solver: transient simulation of a bidirectionally coupled 1D pipe network and 3D field; the image shows a voxel rendering of the coupled field.*

### 1.2 Functional overview {#_1-2-功能全景}

The 107 built-in plugins are divided into 16 discipline groups (97 loaded at startup and 10 fun tools on demand):

| Discipline | Count | Representative plugins |
| --- | --- | --- |
| Chart visualization charts | 16 | Scatter, heatmap, 3D surface |
| Mathematical statistics stats | 8 | Histogram, violin plot, central limit theorem demonstration |
| Mathematical methods math | 3 | Fourier series approximation, complex function domain coloring, ODE vector field |
| Physics simulation physics | 15 | Electromagnetic resonance eigensolver, 1D–3D bidirectional coupling solver, lattice Boltzmann fluid |
| Chemistry chem | 5 | 3D unit cell preview, 3D reaction kinetics, acid–base titration curve |
| Biology bio | 8 | Sequence alignment, population genetics, pharmacokinetic compartment analysis |
| Geography geo | 13 | GeoJSON map, DEM terrain analysis, radiocarbon dating lab |
| Environment env | 8 | Air quality AQI, carbon cycle simulation, Gaussian plume dispersion |
| Astronomy astro | 3 | Astronomy CCD pipeline, transit light-curve fitting, Hertzsprung–Russell diagram |
| Materials materials | 3 | XRD pattern analysis, DSC/TGA thermal analysis, stress–strain analysis |
| Engineering simulation engineering | 4 | Plane truss FEM, DC circuit nodal analysis, control systems lab |
| Economics and finance econ | 2 | Black–Scholes option pricing, spatial prisoner's dilemma evolutionary game |
| Psychology and behavior psych | 2 | Simple reaction time lab, signal detection theory ROC / d′ analysis |
| Data and intelligence data | 2 | AI trainer, image processing |
| Effects rendering fx | 5 | 3D black-hole ray tracing, 3D water-wave fluid, volumetric-cloud sky rendering |
| Fun tools fun | 10 | Koch snowflake, Barnsley fern, Game of Life |

The research workflow is served by 26 task-oriented tool pages, organized into six groups (see article 05):

| Group | Count | Representative tools |
| --- | --- | --- |
| Measurement and evaluation | 2 | Uncertainty suite (Bootstrap / Monte Carlo / MCMC), data profiling |
| Modeling and inference | 4 | Model workbench, Inference Forge (HMC / NUTS), model inference (ONNX), parameter sweep |
| Data and lineage | 6 | SQL workbench (DuckDB-WASM), data lineage, Figure Studio, quick analysis, cleaning wizard, workspace file browser |
| Signals and records | 3 | Signal lab (FFT / Welch PSD / ACF-PACF), Notebook, run history |
| Reporting and reproduction | 5 | Report building, reproducibility lock repro.lock, supplement packaging, course mode, project gallery |
| Toolbox | 6 | Unit conversion, calculator, format conversion, significant figures, molar mass, quick statistics |

Flow mode uses 38 built-in blocks (eight categories: data sources / transforms / filters / math / statistics / units / visualization / plotting) as its “vocabulary”: the compiler performs structural validation, port matching, and cycle detection; the executor caches incrementally per node; statistical blocks include fourteen types such as the t-test family, analysis of variance, Bootstrap, and MCMC sampling.

## Chapter 2. System architecture {#第二章-系统架构}

### 2.1 Overall layering {#_2-1-总体分层}

The entire application is a single-page application (built with Vite 6, React 18 and TypeScript 5.7 strict mode), divided into four layers from top to bottom; lower layers never import higher ones in reverse. The core principle is: **keep the domain core pure TypeScript and unit-testable, keep the UI layer thin, and allow third-party code only in the sandbox**.

```mermaid
flowchart TB
    subgraph L1["界面层（src/pages 与 src/components）"]
        A1["欢迎页：硬件自检 · 模式卡片 · 科研启动网格"]
        A2["工作台：顶栏 · 活动栏 · 多视图侧栏 · 中央标签区 · 右侧面板 · 状态栏"]
        A3["流程画布 · 积木画布 · Monaco 代码编辑器"]
        A4["26 个科研工具整页（ToolShell 统一外壳）"]
    end
    subgraph L2["状态层（src/stores）"]
        B1["19 个 Zustand 状态文件（含流程同步钩子）"]
    end
    subgraph L3["核心服务层（src/core 根模块）"]
        C1["存储 · 工作区 VFS · Git 适配器 · 事件总线 · i18n · 主题包 · 性能监控 · 会话日志"]
        C2["文件格式检测 · WASM 加载 · GPU 服务 · 3D 场景 · 沙箱 · 插件签名"]
    end
    subgraph L35["领域核心层（src/core 已落地子目录，纯 TS 可单测）"]
        E1["stats · io · plot · repro · uncertainty · units"]
        E2["model · signal · sweep · profiler · sql · report · inference"]
        E3["experiment · lineage · chunked · figure · notebook · package"]
        E4["errors · validation · data-quality · cleaning · gallery · course"]
        E5["git · vfs · research · markdown · plugin-tools · geo 等 43 个"]
    end
    subgraph L4["运行时层"]
        D1["插件运行时（src/plugins）：107 个内置插件 · 市场目录 · cspkg · Worker 沙箱"]
        D2["原生核心（native/ergalics-core，Rust 源码交付；浏览器构建产物为占位桩）"]
        D3["语言运行时 Worker：Pyodide（Python）· vendored webR 0.6.0（R，资源缺失时回退 IR 引擎）· 内置 IR 引擎（JavaScript）"]
    end
    L1 --> B1
    B1 --> C1
    B1 --> C2
    B1 --> L35
    B1 --> D1
    C2 --> D1
    D1 --> D2
    B1 --> D3
```

**Layering constraints**

| Layer | Allowed dependencies | Forbidden dependencies |
| --- | --- | --- |
| UI | Core services, stores, domain core | Direct manipulation of runtime details (always go through services) |
| Domain core | Pure TS standard library, internal modules | DOM, React, browser-specific APIs |
| Core services | Domain core, browser APIs | React components |
| Runtime | Browser APIs, WASM | Reverse dependency on the domain core |

Responsibilities and technology choices:

| Layer | Responsibilities | Main technologies |
| --- | --- | --- |
| UI | Routing, modular workbench shell (multi-view sidebar + central tabs + editors dispatched by file), three editors, full research-tool pages, dialogs and onboarding | React 18, react-router-dom 7 (HashRouter) |
| State | 19 domain state files and cross-interface events | Zustand 5 |
| Core services | Cross-cutting services (storage, i18n, themes, performance, sandboxing, signing, etc.) | Pure TypeScript, IndexedDB, Web Workers, pure-TS cryptography independent of WebCrypto |
| Domain core | Scientific computing, research workflows, and reliability kernels, all pure TS and unit-testable in Node | Pure TypeScript |
| Runtime | Plugin registration and lifecycle, sandbox execution, language runtimes, native acceleration | fflate (ZIP), lz-string (compression), Rust and wasm-bindgen 0.2 |

The native core is delivered as Rust source; the browser build artifact is a build-time-generated placeholder stub (`scripts/make-wasm-stub.mjs`). Runtime computation does not rely on it: actual computation uses browser-native WebGPU when available or the CPU implementation accompanying each kernel. Host capabilities such as magic-number detection likewise have pure-TS primary paths, with WASM only as optional assistance.

### 2.2 Routing and page organization {#_2-2-路由与页面组织}

The app uses HashRouter for static deployment compatibility. All routes are lazy-loaded and use `location.pathname` as a key to replay the `.route-stage` entrance animation. Routes:

| Path | Page | Description |
| --- | --- | --- |
| `/` | Welcome | Hardware self-check (WebGPU · WASM · IndexedDB), four mode cards, research-tool launch grid, recent projects |
| `/workbench` | Workbench | Container for Standard / Flow / Block / Code; central tabs hold plugin canvases, file previews, file-dispatched editors (`.py`/`.js`/`.r` → Monaco, `*.flow.json` → Flow graph, `*.block.json` → blocks), and embedded research tools |
| `/studio/:toolId` | Research tool page | Driven by the `RESEARCH_TOOLS` registry, with a unified ToolShell |
| Legacy hash paths (e.g. `/#/signal`) | Redirect | Client-side redirect to `/studio/:toolId` |
| `/settings` | Settings | Global settings, theme marketplace, PWA panel, storage management |
| `/plugin/:pluginId` | Plugin view | Single-plugin detail |
| `/share/:payload` | Share | Render share payload |
| `*` | Redirect | Return to welcome page |

#### 2.2.1 Research tool registry (RESEARCH_TOOLS) {#_2-2-1-科研工具注册表-research-tools}

`src/pages/research/toolRegistry.ts` is the single source of truth for the research interface: each tool declares its `id`, `path`, `legacyPath`, icon, i18n title and description keys, group, whether it appears in the launch grid, whether it requires project context, and its lazy-loaded component once. The `/studio` route, top-bar launcher, and welcome-page launch grid all consume this registry.

There are currently **26 research tools** in six groups:

| Group | Tools |
| --- | --- |
| Measurement and uncertainty measure | uncertainty (uncertainty), profiler (data profiling) |
| Modeling and inference model | model-lab (regression modeling), inference (Inference Forge), model-inference (ONNX inference), sweeps (parameter sweeps) |
| Data and graphs data | sql (SQL workbench), lineage (data lineage), figures (Figure Studio), analysis (quick analysis), cleaning (data cleaning), files (workspace file browser) |
| Signals and sweeps signal | signal (signal lab), notebook (notebook), runs (run history) |
| Delivery and reproduction deliver | report (report building), reprolock (reproducibility lock), supplement (supplementary material), course (course mode), gallery (project gallery) |
| General utilities utils | unit-convert (unit conversion), calc (calculator), format-convert (format conversion), sigfig (significant figures), molar-mass (molar mass), quick-stats (quick statistics) |

Quick analysis `analysis` has `inGrid` set to `false`: it retains a dedicated top-bar button without occupying a launch-grid slot. The general utilities group does not require project context and can be used directly. New research tools must be registered in this table with `legacyPath` configured; scattered routes are prohibited.

### 2.3 Startup sequence {#_2-3-启动时序}

Startup follows the fixed order “self-check, load, restore.” Missing environmental capabilities at any step are reported accurately rather than silently degraded:

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as 欢迎页
    participant P as 插件运行时
    participant S as 项目存储
    U->>W: 打开应用
    W->>W: 硬件自检（WebGPU · WASM · IndexedDB）
    W->>P: 进入工作台，自动加载 97 个核心插件
    P-->>W: 注册表就绪，市场目录呈现全部 107 个
    W->>S: 恢复上次项目或自动保存
    S-->>U: 工作台外壳就位，等待拖入数据
```

Application assembly also runs `initProjectStore` / `initExperimentStore` / `initLineageStore`, making projects, experiment records, and lineage graphs ready before entering any page. `main.tsx` separately warms the plugin-signing module (including the public-key trust registry) and OPFS migration logic.

The welcome-page self-check also determines subsequent operating tiers: when WebGPU is available compute kernels use GPU acceleration; otherwise plugins perform the same computations with mathematically consistent CPU implementations. The native core is delivered as Rust source, and its build artifact is a placeholder stub that does not participate in runtime computation (see article 06).

### 2.4 State management {#_2-4-状态管理}

There are **19 files** under `src/stores/` holding all application state. Cross-cutting UI communication uses a small typed event bus (`src/core/events.ts`), for events such as plugin parameter changes and the host file chooser. Stores cooperate through the event bus rather than directly referencing one another, avoiding circular dependencies.

| Store | Responsibility |
| --- | --- |
| appStore | Host status, banners and notifications, performance metrics, panel switches |
| projectStore | Current project, recent list, save and autosave, sharing, parameter persistence |
| pluginStore | Plugin registry, load and activation lifecycle, file dispatch, host containers, retry after built-in plugin load failure |
| settingsStore | GPU mode, autosave interval, language, PWA, theme packs and other preferences; language uses the i18n module as its sole authority with bidirectional subscription |
| blockStore | Flow graph state, run orchestration, node output cache, run cancellation |
| editorStore | Block and Code sessions (IR, code text, variables, console, language), sanitized field by field on load |
| analysisStore | Column selection, plot type, and analysis results for quick analysis |
| researchStore | Shared research-tool context (current file, recently used tools) |
| experimentStore | Read/write and filtering for experiment runs (IndexedDB runs store) |
| lineageStore | Reconstruction and query of data lineage graphs |
| chunkStore | Chunked-loading task queue and progress |
| figureStore | Figure Studio panel layout, captions, and submission-check state |
| notebookStore | Notebook cells, execution state, and output |
| aiPanelStore | AI assistant panel sessions, mode (offline/online), and authorization state |
| commandPaletteStore | Command palette (Ctrl+K) visibility and action registration |
| shortcutsStore | Keyboard shortcuts help dialog (ShortcutsDialog) visibility and entry registration |
| tourStore / templateTourStore | Onboarding and template-tour progress |
| useFlowSync | Bidirectional Flow graph ↔ shared IR synchronization hook, including hydration-signature guard |

Project lifecycle: create, open, save, autosave, and share. The project format is `.clproj`, compressed with lz-string and stored in IndexedDB; block programs, code sessions, and notebook cells are all persisted in the project file and fully restored when reopened. Projects are also backed by Git repositories (`src/core/git`, isomorphic-git + LightningFS); the sidebar GitPanel provides branch switching, change review, and one-click staging and commit. Flow graphs and block programs are additionally persisted as `.flow.json` / `.block.json` **workspace files** (through `src/core/vfs/`), directly editable by the file explorer's per-file editors; the old `blockGraph` project field remains readable for compatibility. Share links are identified by random UUIDs, and payload size and structure are both validated during resolution to reject malformed data. For large files, `src/core/opfs.ts` provides chunked OPFS storage and `opfs-migration.ts` smoothly migrates existing IndexedDB data.

### 2.5 Rendering pipeline {#_2-5-渲染管线}

The central viewport has three drawing surfaces, whose visibility is centrally managed by the host:

1. **Shared 2D canvas**: All 2D plugins (scatter, line, histogram, heatmap, contour, box, violin, Sankey, etc.) draw on the same canvas, accessed through snapshots provided by the unified 2D viewport abstraction (`viewport2d`).
2. **DOM container**: For plugins needing DOM elements; also where sandboxed plugin canvases are mounted after OffscreenCanvas transfer.
3. **Host-managed Three.js 3D scene**: Created on demand only when a plugin declaring `renderToScene` is activated, with orbit controls, light grid, and responsive sizing.

Visibility decision flow:

```mermaid
flowchart TD
    A["插件被激活"] --> B{"插件声明 renderToScene 能力？"}
    B -- 是 --> C["创建或复用 Three.js 场景<br/>清除 2D 帧残留 · 相机自动适配"]
    B -- 否 --> D["立即隐藏 3D 场景<br/>2D 插件绘制到共享画布"]
    C --> E["轨道控制 · 灯光网格 · 尺寸自适应"]
    D --> F["参数面板绑定插件声明的参数表"]
```

This guarantees a 3D coordinate system never bleeds into a 2D view, or vice versa; end-to-end tests include dedicated assertions for mutual exclusion of the two viewports. For 3D data there are also `src/core/mesh3d.ts` (pure-function 3D mesh data pipeline) and `src/core/pointcloud-gpu.ts` (GPU budget and downsampling strategy for million-point clouds).

### 2.6 Directory structure {#_2-6-目录结构}

Top-level directories under `src/` are blocks, components, core, editor, hooks, i18n, native, pages, plugins, stores, styles, theme, and types. Main locations:

| Location | Contents |
| --- | --- |
| src/core (38 root modules) | storage, events, settings, perf, logger, gpu, compute, gpu-kernels, wgsl, wasm, fileFormat, parse-tasks, parse-worker, worker-pool, scene3d, viewport2d, mesh3d, pointcloud-gpu, sandbox, plugin-worker, pluginCache, cspkg, plugin-signing, crypto-primitives, dataFiles, exampleAssets, examples, download, opfs, opfs-migration, pwa, recentTools, site-links, citation, workspace-artifacts, boot, cpu-info, labHandoff (i18n dictionaries are separately in src/i18n) |
| src/core (43 subdirectories) | stats, io, plot, repro, uncertainty, units, model, signal, sweep, profiler, sql, report, inference, experiment, lineage, chunked, cleaning, figure, notebook, package, gallery, course, templates, theme-pack, submit, bench, validation, errors, data-quality, ai, r, pyodide, chem, monaco, geo, git, markdown, plugin-tools, research, vfs, astro, raytrace, sanitize |
| src/blocks | Flow block system: types, registry, compiler, executor, ops and DataTable operations, block catalog (38 blocks), localization (l10n), render bridge (render.ts) |
| src/editor | Block and Code modes: ir (types, validate, hash, serialize), Flow and Block conversions, block (Blockly engine, definitions, toolbox, theme, samples), code (parsing and samples), codegen (Python, R, JS generators), runtime (interpreter and Studio API) |
| src/components | Workbench shell components (TopBar / ActivityBar / Sidebar / CentralArea / RightPanel / StatusBar / GitPanel), file-dispatched editors (editor/fileEditors), Flow canvas components, Block and Code editor panels, ScienceOutputStrip, feedback and error boundaries, icon set |
| src/pages | welcome, workbench, studio, research (toolRegistry), labs (13 research-tool page components), figures, gallery, notebook, signal, sql, report, sweeps, utils, settings, share, plugin, plugin-dialog |
| src/plugins | Built-in plugins (builtin, 107: 97 autoloaded at startup + 10 fun tools), marketplace catalog (marketplace.ts), sample packages (marketplace-demo-packages.ts), category table (categories.ts) |
| src/stores | Zustand stores (19 files) |
| src/hooks / src/i18n / src/styles / src/theme | Cross-component hooks (CPU information, mode synchronization, panel width), Chinese/English dictionaries and types, global stylesheets, theme foundation |
| src/types | Contract types for plugins, projects, blocks, editors, and DataTable |
| src/native | Build-generated WASM bindings (not committed) |
| native/ergalics-core | Rust native core (lib, device, buffer, compute, utils), delivered as source |
| examples | Sample data (data), sample projects (projects, 11 .clproj files: 8 Flow examples + 3 plugin demos), Code-mode samples (code, 9 Python programs) |
| scripts | About 50 engineering scripts: WASM build and stub generation, example data generation, signing CLI, SBOM / CITATION generation, deployment merging, and 1 smoke + 13 verify end-to-end scripts |
| tests | Vitest unit tests (173 test files, 2,815 cases, 2 skipped without a GPU) |
| docs | VitePress documentation site and this technical documentation directory (technical) |
| website | Official website (project gallery · theme marketplace · plugin marketplace), deployed to the Pages root path |

### 2.7 Dependency rules and chunking strategy {#_2-7-依赖规则与分包策略}

- The UI layer depends on the state layer, the state layer depends on core services and domain core, and core services never import the UI layer.
- The domain core must not access DOM or React; tests run in Node (Vitest). New capabilities should first be implemented as pure-TS modules in `src/core/`, then assembled in the UI layer; domain logic must not be implemented in components.
- Run operations (Flow / Block / Code / notebook / sweeps / uncertainty / modeling / inference) must enter experiment records and lineage through the event bus and must not bypass it.
- The plugin contract (`src/types/plugin.ts`) is the sole shared vocabulary between host and third-party code; the render bridge (`src/blocks/render.ts`) is the block system's only side-effectful module, sending visualization output to plugin renderers so compiler and executor remain testable.
- All heavy dependencies are lazy-loaded chunks: Blockly (about 828 KB) is fetched on first entering Block mode; TensorFlow.js on the first training click; Pyodide on the first Python run; vendored webR 0.6.0 (`public/webr/`) on the first R run, falling back to the built-in IR engine if assets are missing; Monaco and DuckDB-WASM likewise. Initial Standard and Flow screens are unaffected. WASM and Blockly media are vendored to `public/` on the same origin by custom Vite plugins, without an external CDN.
- The app version is injected from package.json through `define.__APP_VERSION__`; hard-coding it is prohibited.
- Error boundaries are isolated by area (top bar and status bar wrapped separately), with bounded retries by incrementing the reset key to avoid error loops.

### 2.8 Observability {#_2-8-可观测性}

| Facility | Capability |
| --- | --- |
| Performance monitoring (perf) | Aggregates frame time and GPU time; alerts users through notifications when thresholds are exceeded instead of silently stalling |
| Run logs (logger plus download) | Session event sequences can be exported to a file for issue reporting and regression diagnosis |
| Status bar | Persistently shows GPU availability, current engine, and performance metrics so users know “what is computing now” |
| Benchmark suite (`src/core/bench/`) | Four categories: import, GPU kernels, render frame rate, and memory; uses `scripts/bench-*.mjs` and `budget-baseline.json` for CI performance-regression gates (see article 08) |
| Reliability kernel (`src/core/errors/`) | Structured error taxonomy, `Result` type, backoff retries, deduplicated error registry, and global `error` / `unhandledrejection` capture turn “silent failures” into reportable events |

## Chapter 3. Plugin system {#第三章-插件系统}

### 3.1 Contract between host and plugin {#_3-1-宿主与插件的契约}

Every plugin implements the common `Plugin` interface (`src/types/plugin.ts`). `manifest`, `init`, and `getParams` are required; all other methods are optional and probed by the host with optional calls, allowing a third-party package to run with only `render` implemented:

| Method | Purpose |
| --- | --- |
| init / destroy | Initialization and destruction; the host handles GPU-safe resource cleanup |
| activate / deactivate | Activation and deactivation, driving 2D/3D viewport switching and stale-frame cleanup |
| render / updateParams | Rendering and parameter updates (reactive form in the right panel) |
| getParams / compute | Read parameter definitions and compute (`compute` has a progress callback) |
| loadData / getSupportedFormats | Receive data dispatched by the host; declare supported file formats |
| renderToScene | Declare 3D capability and receive a host Three.js scene handle when activated |
| onProjectSave / onProjectLoad | Lifecycle hooks after project save and load |

#### 3.1.1 Standard 3D plugin integration: renderToScene and Scene3DHandle {#_3-1-1-3d-插件标准接法-rendertoscene-与-scene3dhandle}

3D plugins do not create their own renderers. They implement `renderToScene(scene)` to obtain the centrally managed host `Scene3DHandle`: its members are actual Three.js objects (root `scene`, `camera` at a preset position, orbit `controls`, `renderer`). The plugin adds meshes and lights and drives the rendering loop through `render()`; `setVisible/isVisible` prevents the 3D coordinate system from bleeding into the 2D viewport when a non-3D plugin is active; `snapshot({ transparent: true })` exports a transparent PNG without background and reference objects; `dispose()` frees GPU resources and stops the rendering loop. When WebGL is unavailable it automatically falls back to a 2D notice.

#### 3.1.2 PluginApi: host-provided capabilities {#_3-1-2-pluginapi-宿主提供的能力面}

| Capability group | Contents |
| --- | --- |
| Localization | `locale`, `t()`, and language-change subscription; the parameter panel is rebuilt with the language |
| Status reporting | `setStatus` reports ready/computing/paused/loading/saving/error to the status bar |
| Performance reporting | `reportGpuTime` and `reportDataScale` feed monitoring and warnings |
| Notifications | `notify` banners and notices by severity |
| Logging | `log` writes to the `plugin:<id>` scope and is exported with run history |
| Cancellation and activation | `onCancel` subscribes to status-bar cancellation; `isActive` prevents background plugins from drawing on the shared canvas |
| File access | `openFile / readText / readBinary` (project files, built-in samples and Code-mode files share the same logic) |
| Parameter read/write | `getParam / setParam` for project-level persistence; `reload` for instance self-recovery |
| Temporary cache | `cache`, an asynchronous plugin-scoped cache released on unload |
| File saving | `exportFile` saves text/binary to user downloads |
| GPU compute surface | `gpu` (createBuffer, write, read, compileKernel, run; see article 06) |

#### 3.1.3 Parameter panel and controls {#_3-1-3-参数面板与控件}

Plugins declare a parameter table in the manifest; the host generates a localized reactive parameter panel supporting eight control types:

| Control | Example use |
| --- | --- |
| Range (slider) | Gravitational constant, damping coefficient |
| Dropdown | Scene preset, projection, palette |
| Number | Bin count, step size |
| Checkbox | Trails, grid visibility |
| Text | Column name, label |
| File | Additional data selection |
| Button | Reseed, export |
| Toggle | Boolean state other than run / pause |

Parameters can declare `group` and `inline`, placing controls in the same group side by side with automatic wrapping.

#### 3.1.4 Lifecycle and lazy loading {#_3-1-4-生命周期与懒加载}

The plugin runtime orchestrates lifecycle centrally. Modules themselves are lazy-loaded: manifests are registered first, while module code is instantiated through dynamic `import()` only when the plugin is loaded; unloaded plugins consume no runtime resources:

```mermaid
flowchart LR
    A["注册（manifest 入注册表）"] --> B["加载（动态 import 模块实例化）"]
    B --> C["激活（视口判定 · 参数面板生成）"]
    C --> D["渲染与参数更新循环"]
    D --> E["去激活（资源保留 · 视口释放）"]
    E --> F["销毁（GPU 安全回收）"]
```

On destruction the host reclaims buffers and event listeners held by the plugin. Failed autoloads can be retried: the runtime treats “initialization complete” as a state-machine node, so the registry does not enter the ready state after failure and a user retry is not mistaken for duplicate loading.

#### 3.1.5 Export {#_3-1-5-导出}

Export has two levels: **canvas-level** export is provided by the central area's unified “Export” menu, downloading the active plugin's 2D canvas or 3D scene as PNG (3D adds a transparent-background option), or saving it under workspace `figures/` through `src/core/vfs/`. **Data-level** export is declared by plugins as parameter-panel button actions (`exportCsv`), exporting their tabular data as RFC-4180 CSV (UTF-8 BOM; simulation plugins have row limits and sampling).

### 3.2 107 built-in plugins (16 discipline groups) {#_3-2-107-个内置插件-16-个学科分组}

Sidebar grouping is determined by `DISCIPLINE_BY_PLUGIN`; unregistered third-party plugins fall back to “chart visualization.” The following tables list all 107 plugins in sidebar order (chart visualization 16 / mathematical statistics 8 / mathematical methods 3 / physics simulation 15 / chemistry 5 / biology 8 / geography 13 / environment 8 / astronomy 3 / materials 3 / engineering simulation 4 / economics and finance 2 / psychology and behavior 2 / data and intelligence 2 / effects rendering 5 / fun tools 10). Of these, 97 load automatically and the 10 fun tools use `autoload: false` and load manually.

#### 3.2.1 Chart visualization (charts, 16) {#_3-2-1-图表可视化-charts-16-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.scatter | 散点图 | Scatter Plot | Render numeric columns (x y [value]) as a 2D scatter plot; the third column can be a color channel |
| example.timeseries | 时间序列绘图 | Time Series | Plot CSV columns as lines varying over time |
| example.heatmap | 热力图 | Heatmap | Render a 2D numeric grid (JSON matrix) as a heatmap |
| example.contour | 等值线图 | Contour | Render a 2D scalar field (JSON grid) as color bands + isolines, suitable for vortex fields, terrain, etc. |
| example.surface-3d | 3D 表面图 | 3D Surface | 3D surface of height-field grid z=f(x,y), using project or sample data with adaptive view |
| example.voxel-3d | 3D 体素渲染 | 3D Voxel Field | Isosurface and translucent voxel rendering of a 3D scalar field from project files, submitted in a single instanced draw |
| example.bar_chart | 柱状图 | Bar Chart | Render categorical data as bars, with horizontal/vertical orientation and palette selection |
| example.bubble | 气泡图 | Bubble Chart | Plot 3D numeric data (x y size [color]) as bubbles; the fourth column can be a color channel |
| example.polar | 雷达图 | Polar Plot | Multi-series radar/polar plots, one dimension per column and one series per row |
| example.network | 网络图 | Network Graph | Force-directed network from edge-list data, with node size, color and animation |
| example.sankey | 桑基图 | Sankey Diagram | Sankey flow from source→target→value edge data, with proportionally scaled ribbons |
| example.treemap | 矩形树图 | Treemap | Hierarchical data as nested rectangles whose areas are proportional to values |
| example.parallel | 平行坐标图 | Parallel Coordinates | Multivariate data on parallel axes, one polyline per row, with optional categorical coloring |
| example.point-cloud | 点云查看器 | Point Cloud | Render .xyz point clouds with adjustable point size and color |
| example.point-cloud-3d | 3D 点云 | Point Cloud 3D | Interactive 3D point clouds in the host Three.js scene, with height coloring and adaptive view |
| example.image | 图像查看器 | Image Viewer | Load and view images (PNG/JPEG/WebP/GIF) |

![Scatter plot: three point clusters](../assets/screenshots/plugins/scatter.png)

*Scatter plot: three point clusters, with the third column mapped to color.*

![Time series: trend line](../assets/screenshots/plugins/timeseries.png)

*Time series: trend with noise overlaid.*

![Sankey diagram: flow ribbons](../assets/screenshots/plugins/sankey.png)

*Sankey diagram: proportionally scaled colored flow ribbons.*

![Bubble chart: bubble encoding](../assets/screenshots/plugins/bubble.png)

*Bubble chart: position and size encode three numeric dimensions.*

![3D surface: gridded surface](../assets/screenshots/plugins/surface-3d.png)

*3D surface: a height-field grid.*

![Heatmap: Viridis color ramp](../assets/screenshots/plugins/heatmap.png)

*Viridis heatmap rendering a 2D numeric grid.*

![3D voxel rendering: translucent sphere](../assets/screenshots/plugins/voxel-3d.png)

*3D voxels: translucent spherical isosurface.*

![Bar chart: monthly data](../assets/screenshots/plugins/bar_chart.png)

*Bar chart of monthly data.*

![Radar chart: five-dimensional indicators](../assets/screenshots/plugins/polar.png)

*Radar chart comparing five-dimensional indicators.*

![Network graph: force-directed layout](../assets/screenshots/plugins/network.png)

*Force-directed network graph.*

![Parallel coordinates: iris](../assets/screenshots/plugins/parallel.png)

*Parallel coordinates: iris data.*

![Treemap: hierarchical data](../assets/screenshots/plugins/treemap.png)

*Treemap: hierarchical data.*

![Point-cloud viewer: 2D point cloud](../assets/screenshots/plugins/point-cloud.png)

*2D point-cloud rendering.*

#### 3.2.2 Mathematical statistics (stats, 8) {#_3-2-2-数学统计-stats-8-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.histogram | 直方图 | Histogram | Distribution histogram for one-dimensional numeric data, with adjustable bin count |
| example.boxplot | 箱线图 | Box Plot | Box plots of grouped numeric data (quartile box + whiskers + outliers) |
| example.violin | 小提琴图 | Violin Plot | Kernel-density violin plots for grouped data, with bandwidth adjustment and box-plot overlay |
| example.qqplot | QQ 图（正态检验） | QQ Plot | Compare sample and standard-normal quantiles; deviation from the diagonal indicates non-normality |
| example.errorband | 误差带图 | Error Band | Line + translucent error band (confidence interval), suitable for uncertain measurements |
| example.stats-clt | 中心极限定理演示台 | Central Limit Theorem Bench | Sample means from uniform / exponential / Bernoulli / bimodal mixture / truncated heavy-tailed Pareto populations, overlay theoretical N(μ, σ²/n), and provide skewness / kurtosis / Jarque-Bera metrics and an embedded validation benchmark |
| example.stats-markov | 马尔可夫链与稳态分析 | Markov Chains & Stationary Analysis | Power-method stationary distribution (L1 residual < 1e-12), ergodicity and periodicity checks, absorbing-chain analysis, trajectory simulation, and PageRank mode with damping 0.85 |
| example.stats-zipf | Zipf 定律词频分析 | Zipf's Law Word Frequencies | Zipf analysis of real corpora: tokenization, frequency ranking, log(rank)–log(freq) least-squares fit (s±σ, R², per-rank residuals), comparison to ideal exponent s=1, and built-in public-domain *Emma* corpus |

![Markov chains: transition graph and trajectories](../assets/screenshots/plugins/stats-markov.png)

*Markov-chain analysis: transition graph and simulated trajectories.*

![Zipf's law: log–log fit](../assets/screenshots/plugins/stats-zipf.png)

*Zipf's law: log–log word-frequency fit.*

![Histogram: bimodal distribution](../assets/screenshots/plugins/histogram.png)

*Histogram: bimodal distribution.*

![Violin plot: built-in box overlay](../assets/screenshots/plugins/violin.png)

*Violin plot with built-in box overlay.*

![Box plot: outliers](../assets/screenshots/plugins/boxplot.png)

*Box plot: whiskers and outliers.*

![Error band: confidence interval of the mean](../assets/screenshots/plugins/errorband.png)

*Mean line with translucent error band.*

![QQ plot: deviation from reference line](../assets/screenshots/plugins/qqplot.png)

*QQ plot: sample deviates from the reference line.*

![Central limit theorem: normal overlay on means](../assets/screenshots/plugins/stats-clt.png)

*Sampling distribution of means with normal curve overlaid.*

#### 3.2.3 Mathematical methods (math, 3) {#_3-2-3-数学方法-math-3-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.math-fourier | 傅里叶级数逼近实验室 | Fourier Series Lab | Piecewise Simpson quadrature at discontinuities for Fourier coefficients; compare ordinary partial sums with Fejér averages; compare Gibbs overshoot ratio against the classical constant 2·Si(π)/π ≈ 1.17898 |
| example.math-domaincolor | 复变函数域着色 | Domain Coloring | Per-pixel domain coloring of f(z) (hue encodes argument, contours of logarithmic modulus); built-in recursive-descent complex-expression parser; counts winding number by the argument principle |
| example.math-odefield | ODE 向量场与流线 | ODE Vector Field & Streamlines | Phase-plane bench for 2D autonomous systems: bidirectional RK4 streamline integration, Newton's method for equilibria, classified by Jacobian eigenvalues |

![Fourier series: square-wave partial sum](../assets/screenshots/plugins/math-fourier.png)

*Fourier series: square-wave partial-sum approximation.*

![Complex-function domain coloring](../assets/screenshots/plugins/math-domaincolor.png)

*Domain coloring: per-pixel image of f(z).*

![ODE vector field and streamlines](../assets/screenshots/plugins/math-odefield.png)

*ODE vector field and streamline integration.*

#### 3.2.4 Physics simulation (physics, 15) {#_3-2-4-物理模拟-physics-15-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.particles | 粒子模拟 | Particles | Interactive particle simulation demonstrating compute progress and performance reporting |
| example.nbody | 引力 N 体模拟 | N-Body Gravity | 3D astrophysical N-body direct gravitational summation, with GPU all-pairs computation and CPU fallback |
| example.fluid | 流体模拟（LBM） | LBM Fluid | 2D lattice Boltzmann channel flow (D2Q9) around an obstacle with vortex shedding; GPU stepwise kernels + CPU fallback |
| example.wave | 波动方程 | Wave Equation | 2D finite-difference wave simulation with Gaussian pulse, twin-source interference and double-slit diffraction; GPU stepping + CPU fallback |
| example.pendulum | 双摆（混沌） | Double Pendulum | Classical RK4 double pendulum: a main pendulum and a “ghost” differing in initial angle by only 0.001 rad (≈0.057°) evolve in parallel, showing chaos's sensitive dependence on initial conditions |
| example.electromag | 电磁场 | Electromagnetism | Drag and release charges on the canvas; motion combines Coulomb force and Lorentz force from a uniform magnetic field whose strength and direction can be set separately |
| example.optics | 光学实验 | Optics Lab | Geometrical-optics ray tracing: convex/concave thin lenses, triangular prism (Snell refraction + dispersion), screen imaging; all elements are draggable on the canvas |
| example.em-eigensolver | 电磁谐振特征值求解器 | EM Eigensolver | Sparse indefinite Hermitian eigenvalue solver of order 100,000 for electromagnetic resonance/microwave devices: thick-restart Lanczos, block LOBPCG, Jacobi-Davidson + MINRES shift-invert |
| example.fluid-cfd-coupler | 1D-3D 双向耦合求解器 | 1D-3D Coupled Solver | Bidirectional 1D pipe-network–3D field coupling: multi-rate time-step coordination, coarse–fine subcycling, forward/reverse boundary coupling, millisecond valve control, conservation audit and accuracy–efficiency tradeoff curves |
| example.physics-schrodinger | 一维量子力学求解器 | 1-D Schrödinger Solver | Finite differences + self-implemented tridiagonal QL eigensolver for energy levels and eigenfunctions of infinite well / harmonic oscillator / finite well / double well; Crank-Nicolson unitary time evolution demonstrates a Gaussian wave packet |
| example.physics-ising | 二维伊辛模型 | 2-D Ising Model | Metropolis and Wolff single-cluster algorithms on a periodic square lattice; susceptibility, specific heat and Binder cumulant; fit χ(T) peak to obtain Onsager critical temperature |
| example.physics-heatengine | 热机循环 p-V 分析台 | Heat Engine Cycles | Integrates ∮p dV by the trapezoidal rule along quasistatic Otto / Diesel / Carnot / (regenerative) Stirling paths, accounts for each branch using Q = ΔU + W, and compares thermal efficiency with closed-form formulas |
| example.physics-diffusion | 热传导 / 扩散方程实验室 | Diffusion Equation Lab | FTCS explicit scheme (D·Δt/Δx²≤0.5 stability check) and Crank–Nicolson implicit scheme, Dirichlet/Neumann boundaries, live maximum relative error against an analytical solution |
| example.physics-diffraction | 衍射实验室 | Diffraction Lab | Numerically evaluates the Fresnel–Kirchhoff diffraction integral, treating near and far fields for single / double / N-slit gratings and circular apertures uniformly |
| example.physics-trajectory | 轨迹运动学与能量分解实验室 | Trajectory Kinematics Lab | Analyze trajectory data (t, x[, y]): three-point Lagrange numerical differentiation, optional Savitzky-Golay smoothing, kinetic/potential energy decomposition and linearized least-squares projectile fitting |

![Electromagnetism: cyclotron example](../assets/screenshots/plugins/electromagnetism.png)

*Electromagnetism: drag and release charges; their cyclotron motion combines Coulomb and uniform-field Lorentz forces, with separately configurable magnetic-field strength and direction.*

![Optics lab: prism dispersion](../assets/screenshots/plugins/optics-prism.png)

*Optics lab: white light refracts and disperses through a triangular prism; convex/concave lenses and other elements are draggable for thin-lens imaging and dispersion demonstrations.*

![Structural mechanics: truss colored by force](../assets/screenshots/plugins/structure-truss.png)

*Structural mechanics: a pinned truss bears load in real time; members are colored by axial force and break successively under overload until overall collapse, illustrating material limits and failure propagation.*

![2D Ising model: spin configuration and heat-capacity peak](../assets/screenshots/plugins/physics-ising.png)

*2D Ising model: spin configuration and heat-capacity peak.*

![Diffusion equation: numerical and analytical comparison](../assets/screenshots/plugins/physics-diffusion.png)

*Diffusion equation: numerical versus analytical solution.*

![Diffraction lab: single-slit fringes](../assets/screenshots/plugins/physics-diffraction.png)

*Diffraction lab: single-slit fringes.*

![Trajectory kinematics: projectile fit and energy decomposition](../assets/screenshots/plugins/physics-trajectory.png)

*Trajectory kinematics: projectile fit and energy decomposition.*

![1D quantum solver: square-well wavefunctions](../assets/screenshots/plugins/physics-schrodinger.png)

*1D Schrödinger: square-well wavefunctions.*

![Heat-engine cycles: Otto p-V diagram](../assets/screenshots/plugins/physics-heatengine.png)

*Heat-engine cycles: Otto p-V diagram.*

![Particle simulation: GPU compute](../assets/screenshots/plugins/particles.png)

*GPU particle simulation.*

#### 3.2.5 Chemistry (chem, 5) {#_3-2-5-化学-chem-5-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.chem-crystal | 晶胞 · 3D 预览 | Crystal · 3D Unit Cell | Load common CIF / POSCAR / XYZ unit-cell formats and view atoms, periodic bonds, effective composition and estimated density in 3D |
| example.chem-reaction | 反应 · 自由反应动力学 3D | Reaction · MD 3D | Built-in NumPy/Langevin engine integrates real trajectories at selected temperature and catalyst conditions—bonds break across Arrhenius barriers and radicals recombine into bonds |
| example.chem-titration | 酸碱滴定曲线实验室 | Titration Curve Lab | Full ionic-equilibrium system (charge + mass balance + Ka + Kw), bisection-protected Newton–Raphson solves [H⁺] at each volume; marks equivalence points, buffer regions and indicator color-change ranges, with analytical cross-check benchmarks |
| example.chem-reaction-order | 反应级数判定与 Arrhenius 分析 | Reaction Order & Arrhenius | Linearized least-squares fits of zero/first/second order to [A]–t data ranked by R², half-life cross-validation, and Arrhenius regression recovering Ea ± σ and pre-exponential factor A |
| example.chem-turing | Gray-Scott 反应扩散图灵斑图 | Gray–Scott Turing Patterns | FTCS explicit differences evolve reaction–diffusion equations on an N×N periodic grid, with Pearson (1993) classical region presets and mass-conservation numerical benchmarks |

![Crystal · 3D unit cell (Rutile, COD 1530150)](../assets/screenshots/plugins/chem-crystal/cell3d.png)

*Crystal · 3D preview: load a CIF unit cell and view atoms, periodic bonds and cell frame as a ball-and-stick model; the Rutile example contains 8 atoms and can be combined with effective-composition and density estimates.*

![Reaction · free reaction dynamics 3D](../assets/screenshots/plugins/chem-reaction/md3d.png)

*Free reaction dynamics 3D: the built-in NumPy / Langevin engine integrates real trajectories at the specified temperature and catalyst conditions—in esterification (ethanol + acetic acid), bonds cross Arrhenius barriers and break, and radicals recombine to form bonds; atomic motion comes from real physics rather than scripted animation.*

![Titration curve: pH jump](../assets/screenshots/plugins/chem-titration.png)

*Titration curve: pH jump.*

![Reaction-order determination: integral-method fit](../assets/screenshots/plugins/chem-reaction-order.png)

*Reaction-order determination: linearized integral-method fit.*

![Gray–Scott Turing patterns](../assets/screenshots/plugins/chem-turing.png)

*Gray–Scott reaction–diffusion Turing patterns.*

#### 3.2.6 Biology (bio, 8) {#_3-2-6-生物学-bio-8-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.protein | 蛋白质交互网络 | Protein Interactions | Protein–protein interaction network and force-directed layout, reporting degree distribution, connected components and other biological metrics |
| example.bio-enzyme | 酶动力学 | Enzyme Kinetics | Michaelis-Menten enzyme kinetics: competitive / noncompetitive / uncompetitive inhibition, Lineweaver-Burk linearization, Levenberg-Marquardt fitting to recover Vmax and Km, reporting kcat and catalytic efficiency |
| example.bio-epidemic | 传染病分室模型 | Epidemic Modeling | Deterministic SIR / SEIR compartment models with classical RK4, reporting R₀, herd-immunity threshold, infection-peak time and total attack rate |
| example.bio-seqalign | 序列比对与分析 | Sequence Alignment | Pairwise sequence alignment using BLOSUM62 / nucleotide matrices (global Needleman-Wunsch or local Smith-Waterman with affine gap penalties), base composition and GC sliding-window analysis, with FASTA support |
| example.bio-popgen | 群体遗传学 | Population Genetics | Hardy-Weinberg equilibrium (HWE) chi-square test and reproducible Wright-Fisher genetic drift simulation with optional natural selection (recessive / additive / dominant) |
| example.bio-pk | 药代动力学室分析 | Pharmacokinetics | One-/two-compartment, IV bolus and oral first-order absorption models; RK4 solutions checked against analytical solutions, with therapeutic-window (MEC/MSC) overlay |
| example.bio-mendel | 孟德尔 F2 分离比 χ² 检验 | Mendel F2 χ² Tests | Chi-square goodness-of-fit tests for monohybrid 3:1 and dihybrid 9:3:3:1 ratios; built-in original F₂ counts for seven traits from the 1866 paper and self-implemented incomplete gamma function for p-values |
| example.bio-neuron | Hodgkin–Huxley 神经元 | Hodgkin–Huxley Neuron | Four-variable RK4 using the original 1952 constants, displaying V(t) and m/h/n gating waveforms, with current pulses and Q10=3 temperature scaling |

![Enzyme kinetics: Michaelis-Menten saturation v=f(S)](../assets/screenshots/plugins/bio-enzyme/saturation.png)

*Enzyme kinetics: v=f([S]) saturation curves compare no inhibition / competitive / noncompetitive / uncompetitive cases; Levenberg-Marquardt recovers Vmax and Km from noisy initial velocities and reports kcat and catalytic efficiency.*

![Epidemic compartment model: SEIR (N=100,000, R₀=2.8)](../assets/screenshots/plugins/bio-epidemic/sirseir.png)

*Epidemic modeling: deterministic SIR / SEIR uses classical RK4. The SEIR example shows S/E/I/R over time, infection-peak time, total attack rate (92.1%) and herd-immunity threshold.*

![Sequence alignment: Needleman-Wunsch global alignment (BLOSUM62)](../assets/screenshots/plugins/bio-seqalign/alignment.png)

*Sequence alignment: BLOSUM62 global (NW) or local (SW) pairwise alignment with affine gap penalties; the example shows two protein sequences aligned, 46.4% identity, 9 gaps and GC analysis.*

![Population genetics: Hardy-Weinberg equilibrium test](../assets/screenshots/plugins/bio-popgen/hwe.png)

*HWE test: enter three genotype counts; the χ² test compares observations with HWE expectations (χ²=0.832, p=0.86 in the image), classifying p ≥ 0.05 as equilibrium.*

![Population genetics: Wright-Fisher drift (N=50, 40 replicates)](../assets/screenshots/plugins/bio-popgen/drift.png)

*Genetic drift: reproducible Wright-Fisher simulation with 40 allele-frequency random-walk trajectories, fixation/loss counts and mean fixation generation, with optional recessive / additive / dominant selection.*

![Enzyme kinetics: v–[S] inhibition fit](../assets/screenshots/plugins/bio-enzyme/inhibition.png)

*Enzyme kinetics: v–[S] inhibition fit.*

![Mendel F₂ χ² test](../assets/screenshots/plugins/bio-mendel.png)

*Mendel F₂ segregation-ratio χ² test.*

![Hodgkin–Huxley neuron: action potential and gating variables](../assets/screenshots/plugins/bio-neuron.png)

*Hodgkin–Huxley neuron: action potential and gating variables.*

![Wright–Fisher drift: 40 trajectories](../assets/screenshots/plugins/bio-popgen/drift-replicates.png)

*Wright–Fisher drift: 40 replicate trajectories.*

![Needleman-Wunsch global alignment](../assets/screenshots/plugins/bio-seqalign/nw-global.png)

*Needleman–Wunsch global sequence alignment.*

![SEIR epidemic model: compartment curves](../assets/screenshots/plugins/bio-epidemic/seir.png)

*SEIR epidemic model: compartment time curves.*

![Protein interactions: residue network](../assets/screenshots/plugins/protein-network.png)

*Protein interactions: residue interaction network.*

![Pharmacokinetics: concentration–time curve and therapeutic window](../assets/screenshots/plugins/bio-pk.png)

*Pharmacokinetics: concentration–time curve and therapeutic window.*

#### 3.2.7 Geography (geo, 13) {#_3-2-7-地理-geo-13-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.geomap | GeoJSON 地图 | GeoJSON Map | Offline GeoJSON polygon/line/point rendering, numeric-attribute choropleths and Mercator / equirectangular projections |
| example.geo-solar | 太阳高度与昼夜长短 | Solar Elevation & Day Length | Given latitude and date, calculate solar declination, noon elevation, day length and local sunrise/sunset; plot annual day length and noon elevation curves |
| example.geo-climograph | 气候直方图 | Climatograph | Monthly dual-axis temperature line + precipitation bars; automatically summarizes annual mean temperature, annual precipitation, annual temperature range and seasonal precipitation, and classifies climate |
| example.geo-pop-pyramid | 人口金字塔 | Population Pyramid | Back-to-back age/sex pyramid (men left, women right, age increasing upward), calculating 0-14 / 15-64 / 65+ proportions and total sex ratio and classifying structure |
| example.geo-interp | 空间插值 | Spatial Interpolation | Grid discrete station observations using inverse-distance weighting (IDW, adjustable power) and ordinary kriging (automatically fit spherical/exponential models to empirical variograms); outputs heatmap, isolines and station labels |
| example.geo-measure | 距离与面积量算 | Distance & Area Measure | Add points by clicking: distance mode reports segment great-circle distances and cumulative distance; area mode uses spherical polygon formulas for enclosed area and perimeter |
| example.geo-tissot | 投影变形（Tissot 圆） | Projection Distortion (Tissot) | Draw world coastlines and Tissot indicatrices under seven projections: equirectangular, Mercator, sinusoidal, Mollweide, Gall–Peters, azimuthal equal-area and orthographic |
| example.geo-terrain | DEM 地形分析 | DEM Terrain Analysis | Parse ESRI ASCII Grid (.asc) elevation data: elevation coloring, hillshade, Horn slope/aspect, contour overlay and 3D model view |
| example.geo-gpx | GPX 轨迹分析 | GPX Track Analysis | Parse GPX track points including elevation/time; calculate total distance, cumulative ascent/descent (2 m hysteresis filter), elapsed time and extrema; plot elevation-colored track and elevation–distance profile |
| example.geo-globe | 交互地球仪（3D） | Interactive Globe (3D) | True 3D globe with drag rotation and scroll zoom: Natural Earth 110m coastlines and graticule on the sphere, spherical Tissot indicatrices and optional auto-rotation |
| example.geo-carbondating | 放射性碳定年实验室 | Radiocarbon Dating Lab | Libby conventional age (5568-year half-life, BP=1950), likelihood-profile calibration against the IntCal20 atmospheric curve (1σ/2σ intervals), and inverse-variance combination of multiple samples |
| example.geo-soilwater | 土壤水分特征曲线拟合 | Soil Water Retention Fit | Levenberg-Marquardt nonlinear least squares for van Genuchten (1980) model (box constraints + covariance standard errors), reporting specific water capacity C(h), effective saturation and equivalent pore radius |
| example.geo-hydrology | SCS 降雨径流模型 | SCS Runoff Event | Partition effective rainfall with the SCS curve-number method, then convolve with an SCS synthetic unit hydrograph (triangular or NOHRSC dimensionless curve table) to produce direct runoff; volume conservation reaches machine precision |

![Climatograph: Beijing monthly temperature and precipitation](../assets/screenshots/plugins/climatograph.png)

*Climatograph: monthly temperature line (left axis) + precipitation bars (right axis); Beijing is summarized as 12.7 ℃ annual mean, 527 mm precipitation, 29.9 ℃ annual range and a classified climate type.*

![Population pyramid: China 2020](../assets/screenshots/plugins/population-pyramid.png)

*Population pyramid: back-to-back age/sex groups (men left, women right), with 0-14 / 15-64 / 65+ proportions, sex ratio (105.7), and growing / stable / shrinking classification.*

![Spatial interpolation: IDW gridding 31 stations](../assets/screenshots/plugins/spatial-interpolation.png)

*Spatial interpolation: IDW (p=2) grids observations from 31 stations into a heatmap and isolines, with LOOCV RMSE / MAE and Moran's I spatial-autocorrelation test.*

![Projection distortion: Tissot indicatrices on Mollweide](../assets/screenshots/plugins/projection-distortion.png)

*Tissot indicatrices with world coastlines under seven projections: area ratio indicates area distortion and flattening indicates angular (shape) distortion; the image shows the equal-area Mollweide projection.*

![DEM terrain analysis: 3D mesh view](../assets/screenshots/plugins/terrain-3d-mesh.png)

*DEM terrain analysis (3D Mesh): ESRI ASCII Grid elevations form a height-colored 3D surface with adjustable vertical exaggeration and optional contours.*

![DEM terrain analysis: slope with contours](../assets/screenshots/plugins/terrain-slope.png)

*DEM terrain analysis (slope view): Horn-method slope (0-72°) with contours; another mode provides hillshade for extracting slope and aspect.*

![GPX track analysis: elevation-colored track and profile](../assets/screenshots/plugins/gpx-track.png)

*GPX analysis: parsed track points are colored by elevation on the left (46 points, 11.19 km, +217 m / −217 m); the right shows elevation against distance and totals for distance and ascent / descent.*

![Interactive globe (3D): Natural Earth coastlines and spherical Tissot indicatrices](../assets/screenshots/plugins/globe-3d.png)

*Interactive globe: true 3D drag rotation and scroll zoom, Natural Earth 110m coastlines on the sphere, spherical Tissot indicatrices and auto-rotation.*

![Distance and area: polyline distance and standard-deviation ellipse](../assets/screenshots/plugins/standard-deviation-ellipse.png)

*Distance and area: click points for segment great-circle and cumulative distances; for ≥3 points, also compute a standard-deviation ellipse (SDE a / b semi-axes and azimuth) and enclosed area. The image shows six Yangtze cities and their ellipse.*

![Solar elevation and day length](../assets/screenshots/plugins/geo-solar.png)

*Solar elevation and day length: annual day-length curve.*

![Distance and area measure](../assets/screenshots/plugins/geo-measure.png)

*Distance and area measurement.*

![Projection distortion: Tissot indicatrices on Mollweide](../assets/screenshots/plugins/tissot-mollweide.png)

*Projection distortion: Tissot indicatrices on the Mollweide projection.*

![Climatograph: Cairo](../assets/screenshots/plugins/climatograph-cairo.png)

*Climatograph: Cairo monthly temperature and precipitation.*

![Radiocarbon dating: calibration curve](../assets/screenshots/plugins/geo-carbondating.png)

*Radiocarbon dating: IntCal20 calibration curve.*

![Soil-water retention curve fitting](../assets/screenshots/plugins/geo-soilwater.png)

*Soil-water retention curve fitting.*

![SCS rainfall–runoff: hydrograph](../assets/screenshots/plugins/geo-hydrology.png)

*SCS rainfall–runoff hydrograph.*

#### 3.2.8 Environment (env, 8) {#_3-2-8-环境-env-8-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.env-aqi | 空气质量评价（AQI） | Air Quality (AQI) | Piecewise linear interpolation under HJ 633-2012 calculates each pollutant IAQI and daily AQI, reporting level, primary pollutant and health guidance; switch to US EPA breakpoints for comparison |
| example.env-water | 水质评价（地表水分类） | Water Quality | Classify water-sample indicators into grades Ⅰ–Ⅴ under GB 3838-2002; single-factor method takes the worst grade as the overall result and plots a radar chart relative to limits |
| example.env-greenhouse | 温室效应模拟 | Greenhouse Effect | Zero-dimensional radiative-balance teaching model: CO₂/albedo/cloud sliders estimate equilibrium warming with Myhre radiative forcing |
| example.env-carbon | 碳循环推演 | Carbon Cycle | Four-pool box model (atmosphere/vegetation/soil/ocean, GtC), donor-controlled annual fluxes and time stepping driven by anthropogenic-emission sliders and presets |
| example.env-biodiversity | 生物多样性指数 | Biodiversity Indices | From species-by-quadrat abundance, calculate richness S, Shannon H′, Gini-Simpson and Pielou evenness J for each site and mark dominant species |
| example.env-plume | 污染物扩散模拟（高斯烟羽） | Pollutant Dispersion | Calculate a continuous point-source downwind ground-concentration field using Pasquill–Gifford dispersion parameters and ground reflection; display plume as a heatmap |
| example.env-earth3d | 3D 全球环境 | 3-D Global Environment | Illustrate 3D Earth environmental factors: global CO₂ color bands (including seasonal breathing), surface albedo layer and major ocean-current direction arrows, with month slider |
| example.env-predator-prey | 捕食者-猎物（Lotka–Volterra） | Predator–Prey (Lotka–Volterra) | RK4 integration, phase diagram and time series, numerical accuracy checked by invariant drift, and log-space linear regression estimating α/β/γ/δ |

![Air quality: daily AQI bars](../assets/screenshots/plugins/env-aqi.png)

*Daily AQI bar chart.*

![Biodiversity: stacked species abundance](../assets/screenshots/plugins/env-biodiversity.png)

*Stacked species abundance for three sites.*

![Pollutant dispersion: Gaussian plume concentration](../assets/screenshots/plugins/env-plume.png)

*Gaussian-plume ground concentration.*

![3D global environment: albedo layer](../assets/screenshots/plugins/env-earth3d.png)

*3D Earth albedo layer.*

![Water quality: indicator radar chart](../assets/screenshots/plugins/env-water.png)

*Water-quality radar chart and WQI rating.*

![Greenhouse effect: 0D energy balance](../assets/screenshots/plugins/env-greenhouse.png)

*Greenhouse simulation: zero-dimensional energy balance ΔT.*

![Carbon cycle: box model](../assets/screenshots/plugins/env-carbon.png)

*Carbon cycle: four-pool box model.*

![Predator–prey: phase trajectory](../assets/screenshots/plugins/env-predator-prey.png)

*Predator–prey: Lotka–Volterra phase trajectory.*

#### 3.2.9 Astronomy (astro, 3) {#_3-2-9-天文-astro-3-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| astro.pipeline | 天文 CCD 管线 | Astronomy CCD Pipeline | Research-grade CCD image processing: FITS I/O, bias/dark/flat calibration and cosmic-ray rejection, σ-clipped background statistics, local-maximum star detection and aperture photometry, with deterministic Moffat PSF simulator |
| example.astro-transit | 凌星系外行星光变拟合 | Exoplanet Transit Fitting | Simplified BLS period detection + Levenberg-Marquardt trapezoid fit (P, T0, depth, T14, T23, baseline), reporting 1σ parameter errors, phase-folded plot and radius ratio √δ |
| example.astro-hrdiagram | 赫罗图（HR 图） | Hertzsprung–Russell Diagram | Color–magnitude scatter (B−V versus V, or absolute magnitude M_V from Hipparcos parallax), with empirical main-sequence reference and solar anchor; supports linear main-sequence fit |

![Astronomy CCD pipeline: simulated star field and detection circles](../assets/screenshots/plugins/astro-pipeline.png)

*CCD pipeline: simulated star field and source-detection circles.*

![Transit fitting: light curve and phase folding](../assets/screenshots/plugins/astro-transit.png)

*Transit fitting: light curve and phase folding.*

![Hertzsprung–Russell diagram: color–magnitude scatter and main sequence](../assets/screenshots/plugins/astro-hrdiagram.png)

*Hertzsprung–Russell diagram: color–magnitude scatter and main-sequence reference.*

#### 3.2.10 Materials (materials, 3) {#_3-2-10-材料学-materials-3-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.mats-xrd | XRD 衍射图谱分析 | XRD Pattern Analysis | Prominence-based peak detection in powder diffraction (2θ–intensity), Bragg-law d-spacing conversion, least-squares cubic lattice refinement and common phase-card comparison |
| example.mats-mech | 应力-应变分析 | Stress-Strain Analysis | Tensile metrics from engineering stress–strain curves: Young's modulus, 0.2% offset yield strength, tensile strength, elongation, Hollomon hardening exponent, specific resilience and fracture toughness |
| example.mats-thermal | 热分析（DSC/TGA） | Thermal Analysis (DSC/TGA) | Peak detection and extrapolated onset/peak temperatures after baseline correction; DSC integrates transition enthalpy, TGA decomposes weight-loss steps and reports onset and residual mass |

![XRD: diffraction peaks and d values](../assets/screenshots/plugins/mats-xrd.png)

*Silicon-sample XRD diffraction peaks and d-value annotations.*

![Thermal analysis: DSC/TGA curves](../assets/screenshots/plugins/mats-thermal.png)

*DSC/TGA weight-loss step curves.*

#### 3.2.11 Engineering simulation (engineering, 4) {#_3-2-11-工程仿真-engineering-4-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.structure | 结构力学 | Structural Mechanics | Truss load demonstration: click Run to observe axial forces rise under self-weight and a heavy load, material-limit breakage and eventual overall collapse |
| example.eng-circuit | 直流电路节点分析 | DC Circuit Node Analysis | Modified nodal analysis (MNA) + Gaussian elimination with partial pivoting solve node voltages of JSON netlist circuits, draw node–branch topology and report Tellegen power-balance diagnostics |
| example.eng-truss | 平面桁架有限元分析 | Plane Truss FEA | Assemble bar-element stiffness matrices with two DOFs per node, apply constraints by row method and solve with Gaussian partial pivoting; report displacements, axial forces (tension positive, compression negative), stresses and support reactions with deformation overlay |
| example.eng-control | 控制系统实验室 | Control Systems Lab | RK4 unit-step response of first-/second-order systems + PID feedback (overshoot, peak time, settling time, steady-state error); sweep s = jω for Bode plots and −3 dB bandwidth |

![Plane truss FEA: force coloring and deformation](../assets/screenshots/plugins/eng-truss.png)

*Plane truss FEM axial-force coloring and deformation overlay.*

![Control systems: step response and Bode plot](../assets/screenshots/plugins/eng-control.png)

*Control systems: step response and Bode plot.*

![DC circuit: node voltages and topology](../assets/screenshots/plugins/eng-circuit.png)

*DC circuit: node voltages and topology.*

#### 3.2.12 Economics and finance (econ, 2) {#_3-2-12-经济与金融-econ-2-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.econ-blackscholes | Black-Scholes 期权定价实验室 | Black-Scholes Option Lab | Black-Scholes-Merton analytical pricing and Greeks (Delta/Gamma/Vega/Theta), fixed-seed Monte Carlo geometric Brownian motion cross-check, put–call parity residual certification and MC convergence bands |
| example.econ-evogame | 空间囚徒困境演化博弈 | Spatial Prisoner's Dilemma | Nowak-May spatial evolutionary game: C/D strategies play prisoners' dilemma against eight neighbors plus self on a 2D grid; the next generation adopts the highest-scoring neighboring strategy, outputting cooperation-rate time series and qualitative spatial-pattern criteria |

![Black-Scholes: option value and MC convergence](../assets/screenshots/plugins/econ-blackscholes.png)

*BSM option-price curve and Monte Carlo convergence.*

![Spatial prisoner's dilemma: strategy grid](../assets/screenshots/plugins/econ-evogame.png)

*Spatial prisoner's dilemma strategy grid and cooperation rate.*

#### 3.2.13 Psychology and behavior (psych, 2) {#_3-2-13-心理与行为-psych-2-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.psych-sdt | 信号检测论 ROC / d′ 分析 | Signal Detection ROC / d′ | Calculate d′, β, decision criterion c and AUC from hit/false-alarm rates (or uploaded trial data), plot analytical ROC and signal/noise distribution overlap, support unequal-variance coefficient |
| example.psych-rt | 简单反应时实验室 | Reaction Time Lab | In-browser simple reaction-time experiment reporting n/mean/median/SD/SEM/exact 95% t confidence interval, two-condition Welch t-test, Cohen's d and outlier screening |

![Reaction time: histogram and box plot](../assets/screenshots/plugins/psych-rt.png)

*Reaction-time histogram and box plot.*

#### 3.2.14 Data and intelligence (data, 2) {#_3-2-14-数据与智能-data-2-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| example.ai-training | AI 训练 | AI Trainer | Train regression/classification models with TF.js and show live loss curves and visualizations |
| example.data-imageproc | 图像处理 | Image Processing | Self-implemented image-processing kernels: radix-2 2D FFT, spatial/frequency convolution, separable Gaussian blur, unsharp sharpening, Sobel edges, histogram equalization and PSNR/MSE |

![Image processing: before/after sharpening](../assets/screenshots/plugins/data-imageproc.png)

*Image processing before and after sharpening.*

#### 3.2.15 Effects rendering (fx, 5) {#_3-2-15-特效渲染-fx-5-个}

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| fx.blackhole | 黑洞 · 3D 光线追踪 | Black Hole · 3D Ray Tracer | Real-time general-relativistic ray tracing: per-pixel RK4 integration of Schwarzschild null geodesics, with Doppler-beamed accretion disk, gravitational redshift and lensed star field |
| fx.water | 水波 · 3D 流体 | Water · 3D Fluid Waves | FDTD wave solver (drops, rain, twin-source interference, absorbing boundary, pool-floor caustics) + Gerstner sea with exact deep-water dispersion ω²=g·k |
| fx.cloud | 体积云 · 天空渲染器 | Volumetric Clouds · Sky Renderer | Ray-marched volumetric clouds: wind advection, Beer–Lambert extinction + Henyey–Greenstein scattering, self-shadowed light-path integration; sun/moon positions from real astronomical ephemeris formulas (Meeus) |
| fx.sky | 日光天空 · 大气散射 | Daylight Sky · Atmosphere | Analytical single-scattering atmosphere (Nishita type): Rayleigh + Mie scattering and turbidity, physical twilight shadow, limb-darkened solar disk and moon illuminated by phase |
| fx.stars | 星空 · 夜天渲染器 | Starfield · Night Sky | Procedural stars + true galactic-plane Milky Way + diurnal stellar motion (GMST): Bortle light pollution, moonlight washout, seeing scintillation and Poisson meteors |

![Black hole · 3D ray tracing](../assets/screenshots/plugins/fx-blackhole.png)

*Black-hole 3D ray-traced rendering.*

![Water waves · 3D fluid: water surface](../assets/screenshots/plugins/fx-water.png)

*Water waves · 3D fluid: 3D surface waves.*

![Starfield · night sky: Milky Way](../assets/screenshots/plugins/fx-stars.png)

*Starfield · night sky: Milky Way rendering.*

#### 3.2.16 Fun tools (fun, 10, manually loaded with autoload: false) {#_3-2-16-趣味工具-fun-10-个-autoload-false-手动加载}

All plugins in this group declare `autoload: false`: they do not load at startup; the user must manually load them from the plugin panel or marketplace tab before their modules are instantiated.

| Plugin ID | Chinese name | English name | Description |
| --- | --- | --- | --- |
| fun.mandelbrot | 分形浏览器 | Fractal Explorer | Mandelbrot and Julia set explorer with multiple palettes and zoom |
| fun.spirograph | 万花尺 | Spirograph | Generate hypotrochoid spirograph curve art |
| fun.lissajous | 利萨茹曲线 | Lissajous | Animated parametric Lissajous curves with adjustable frequency and phase |
| fun.life | 生命游戏 | Conway's Game of Life | Classic cellular automaton with play/pause/reseed |
| fun.harmonograph | 谐振记录仪 | Harmonograph | Harmonic curve art from superposed decaying sine waves |
| fun.palette | 配色探索器 | Palette Explorer | Two-color gradient preview and generated palette examples |
| fun.koch | 科赫雪花 | Koch Snowflake | Koch snowflake from recursive polylines, with adjustable iteration depth |
| fun.barnsley | 巴恩斯利蕨 | Barnsley Fern | Fern drawn using four affine transforms in an iterated function system (IFS) |
| fun.fireworks | 烟花 | Fireworks | Particle fireworks with gravity and trails, automatic bursts and manual detonation |
| fun.truchet | 特鲁谢瓷砖 | Truchet Tiles | Flowing patterns from randomly oriented arc tiles, with density and palette controls |

![Palette explorer: color steps](../assets/screenshots/plugins/fun-palette.png)

*Palette with 12 color steps.*

![Koch snowflake: iterative fractal](../assets/screenshots/plugins/fun-koch.png)

*Koch snowflake, 6 iterations.*

![Barnsley fern: IFS fractal](../assets/screenshots/plugins/fun-barnsley.png)

*Barnsley fern, 300,000 points.*

![Harmonograph: pendulum art](../assets/screenshots/plugins/fun-harmonograph.png)

*Harmonograph winding pendulum curves.*

Total: 16 + 8 + 3 + 15 + 5 + 8 + 13 + 8 + 3 + 3 + 4 + 2 + 2 + 2 + 5 + 10 = **107** (97 automatic + 10 manual).

All simulation plugins are strictly data-driven: initially empty, never fabricating a default scene. The canvas displays an explicit empty state; run buttons guard against missing data and notify the user rather than silently running empty; “reset” only replays loaded data and returns to the author's benchmark configuration. Every core plugin includes a sample dataset (see `examples/data/`), loadable in one click from the sample-data dialog to see actual visualization.

### 3.3 Research metadata, scientific output and Figure Studio integration {#_3-3-科研级元数据、科学输出与-figure-studio-联动}

#### 3.3.1 Four research-readiness levels in manifest.research {#_3-3-1-manifest-research-四级研究就绪度}

A plugin manifest can declare `research` metadata (`PluginResearchMeta`), rendered as a tier badge in the marketplace and detail view. Without it there is no rating (third-party packages have no badge by default). The four tiers are:

| Tier | Meaning |
| --- | --- |
| research | Literature-based algorithm + reference-solution comparison + true-residual certification + benchmarks/tests |
| quasi-research | Real data input and correct kernel, but some scientific output / diagnostics / reproducibility hooks may be missing |
| demonstration | Can load data, but output is primarily visual, without numerical conclusions |
| educational | Parameter-slider driven, with built-in/approximate data or zero-dimensional model, solely for teaching demonstrations |

Fields include `tier` (one of the four), `units` (physical units of key quantities, e.g. `{ length: 'm', time: 's' }`), `benchmarks` (ids of validation benchmark scenarios runnable in the plugin), `reproducible` (deterministic results for the same seed and input), and `notes` (scope displayed with the badge). `.cspkg` manifest validation rejects unknown tiers; packages declaring research tier must provide nonempty `benchmarks` (also covering a `reproducible: true` declaration).

#### 3.3.2 Unified scientific output bus {#_3-3-2-统一科学输出总线}

`src/core/research/scienceOutput.ts` is a pure-TypeScript structured scientific-output bus: in addition to “compute then draw,” plugins publish numerical conclusions such as fit quality, residuals, confidence intervals and convergence/conservation diagnostics as `ScienceMetric` (key/label/value/unit/severity/hint) through `setScienceOutputs`. `ScienceOutputStrip` subscribes and renders them in a dedicated strip beside the viewport. Metrics are stored by plugin id, so switching plugins automatically switches the displayed conclusions; a plugin without valid results clears its publication so stale conclusions do not remain. Numeric formatting uses adaptive precision (4 significant digits, exponential notation for extremes); NaN/Infinity display as “—” rather than silently disappearing.

#### 3.3.3 Send to Figure Studio {#_3-3-3-发送到-figure-studio}

Research-grade suite plugins (32 total across nine suites: chemistry, physics, engineering, biology and environment, earth science, math, statistics, economics and psychology, astronomy and data) and 8 geography plugins provide a “Send to Figure Studio” button: assemble the current analysis into a multi-panel scientific figure (Chinese/English titles and captions, formula annotations) and send it to the figure workbench in one click. The two solver plugins (electromagnetic resonance eigensolver and 1D-3D bidirectional coupling solver) also support it. The central bridge is `pushPanelsToFigure` in `src/core/figure/sheet.ts`: create a figure sheet → add each panel (336×252 standard panels, three columns in row-major order, a/b/c labels) → attach bilingual caption → notify the user. If data or an open project is missing, an explicit notice is shown rather than silent failure.

### 3.4 Marketplace catalog and two-level loading {#_3-4-市场目录与两级加载}

The marketplace catalog (`src/plugins/marketplace.ts`) presents each built-in with featured labels, popularity and category filters (scientific, fun, utility); community “coming soon” entries are placeholders. `marketplace-demo-packages.ts` provides signed sample packages that can actually be installed, allowing the full “sign → trust → sandbox install” flow to be practiced in the UI. Loading has two levels:

```mermaid
flowchart LR
    A["应用启动"] --> B["自动加载 97 个插件"]
    A --> C["10 个趣味工具插件保持未加载"]
    C --> D["用户从插件面板或市场标签页手动加载"]
    B --> E["注册表就绪<br/>首屏保持轻量"]
    D --> E
```

Every built-in registry entry declares a manifest, `autoload` flag and dynamic `import()` loader: module code is fetched only when the plugin is loaded; an unloaded plugin occupies only a manifest record.

### 3.5 Third-party packages (.cspkg), sandbox and signing {#_3-5-第三方包-cspkg-、沙箱与签名}

A `.cspkg` is a ZIP archive (packed with fflate) containing `manifest.json`, an entry module and assets. Before loading, `src/core/cspkg.ts` validates required fields, plugin id format, package-relative entry path (rejecting `..`, absolute paths and drive letters), and sandbox enum. Archive keys are normalized; traversal and absolute-path keys are discarded, and oversized archives are rejected before decompression (zip-bomb protection). The manifest declares `sandbox`:

```jsonc
{
  "id": "com.example.analyzer",
  "name": "Analyzer",
  "version": "1.2.0",
  "author": "Example Corp",
  "description": "…",
  "entry": "dist/index.js",
  "sandbox": "isolated",        // "isolated"（默认）| "trusted"
  "formats": [{ "extension": ".dat" }]
}
```

- **isolated (default)**: entry code runs in a Web Worker with its own global scope and cannot access host-page globals, DOM or stores; canvas rendering uses a transferred OffscreenCanvas, and host–Worker communication uses only typed RPC (`src/core/sandbox.ts` and `src/core/plugin-worker.ts`).
- **trusted**: executes in host context with full DOM access; recommended only for in-house packages.

Third-party plugin loading and communication:

```mermaid
sequenceDiagram
    participant U as 用户
    participant H as 宿主（cspkg 加载器）
    participant V as 清单与签名校验
    participant W as Worker 沙箱
    U->>H: 选择 .cspkg 文件
    H->>V: 解压并校验 manifest 与签名
    V-->>H: 校验通过（id 格式、入口路径、沙箱枚举、信任来源）
    H->>W: 在 Worker 内执行入口模块
    W-->>H: 通过 postMessage RPC 上报渲染与状态
    H-->>U: 画布经 OffscreenCanvas 呈现
```

#### 3.5.1 Package signing and trust registry {#_3-5-1-包签名与信任注册表}

Signing answers “**who published this package**”; sandboxing answers “**what can it do at runtime**.” They are independent—a valid signature does not weaken isolation.

| Stage | Implementation |
| --- | --- |
| Algorithm | Ed25519 (RFC 8032) and SHA-256 (FIPS 180-4), self-implemented in pure TypeScript using BigInt without WebCrypto (Ed25519 support varies across browsers and Node) |
| Signature payload | Normalized package payload: stable JSON with recursively sorted manifest keys, no whitespace and undefined removed, plus entry bytes; signing CLI and browser verifier agree byte-for-byte |
| Fingerprint | `ed25519:<hex32>`—first 16 bytes of SHA-256 of the public key |
| Trust model | `verifyPackageSignature` returns structured results with `unsigned` / `untrusted-key` / pass; unsigned packages are rejected by default, while a valid signature from an unknown key prompts the user to check the fingerprint and explicitly trust it |
| Trust registry | Built-in official public-key constant `OFFICIAL_TRUSTED_KEYS`; user-added trusted keys persist via `storage.ts`, degrading gracefully if IndexedDB is unavailable |
| Toolchain | `node scripts/sign-cspkg.mjs --genkey <keyfile>` generates keys; `<package-dir> --key <keyfile>` signs and produces .cspkg; `--verify <file.cspkg> [--trust <keyfile>]` verifies again |

Known limits (recorded candidly): the Worker and page share same-origin IndexedDB. When Workers are unavailable, the legacy fallback (`new Function` with shadowed globals) is only a best-effort approximation, not a security boundary; the interface explicitly warns when it is enabled.

### 3.6 File routing and sample data {#_3-6-文件路由与示例数据}

When a user drags any file into the central area or plugin list, the host identifies its format by magic number and extension (optionally aided by WASM) and routes it to a matching plugin:

```mermaid
flowchart TD
    A["文件拖入中央视口"] --> B["读取文件头（魔数）"]
    B --> C["扩展名辅助匹配"]
    C --> D{"科研二进制格式？"}
    D -- 是 --> E["科研数据调度器<br/>（HDF5 · NetCDF · FITS · Zarr · Parquet）"]
    D -- 否 --> F{"唯一匹配插件？"}
    E --> F
    F -- 是 --> G["直接路由并激活"]
    F -- 否 --> H["弹出选择对话框由用户决定"]
    G --> I["示例数据对话框可一键加载该插件附带的示例数据"]
    H --> I
```

The import dialog also filters by file format, so unrecognized files do not enter the parser. Before parsing, large files go through row-window reading and content fingerprints in `src/core/chunked/`; `parse-worker.ts` and `worker-pool.ts` run parsing in a Worker pool to avoid blocking the main thread.

Sample data is registered centrally by the `examples` module (`BUILTIN_EXAMPLES` in `src/core/examples.ts`, each record mapping a sample file to a plugin id) and shown by plugin in the top-bar sample-data dialog. `examples/data/` contains 138 data files, `examples/projects/` contains 11 `.clproj` sample projects, and `examples/code/` contains 9 Python examples. Content fingerprints (shared by `citation.ts` and storage) let repeated imports of the same data be recognized and reused.

## Chapter 4. Four working modes {#第四章-四大工作模式}

### 4.1 Standard mode {#_4-1-标准模式}

The default entry experience. The workbench is a modular shell: top bar (brand and project dropdown, four-mode switch, data and research entry points); a left activity bar switching among Files, Git, and Plugins (the sidebar is resizable and collapsible); a central tab area (active plugin canvas, file previews, editors dispatched by file type, and embedded research tools coexist as tabs; the first launch shows a drop zone); a right parameter panel (turns the active plugin's declared parameters into a reactive form); and a persistent status bar showing GPU availability and performance metrics. The host routes dropped files by magic number and extension, presenting a chooser when multiple plugins match.

Top-bar actions are grouped semantically and separated by dividers: the project-name dropdown (recent-project switching in the upper section; New / Open / Open Folder / Rename / Save As / Delete / Export Logs in the lower section), the `[标准 | 流程 | 积木 | 代码]` mode switch (with an IR synchronization status dot), the `[数据 | 示例]` data group (the data button has a project-file-count badge), the `[保存 | 分享]` project group, the `[分析 | 科研▾]` research group (the research launcher lists 25 launch-grid tools grouped by discipline, with search filtering and recent use; see article 05), and the right-side global icon group (command palette, shortcuts, AI assistant, guide, performance, language, theme; folded into the ⋯ overflow menu on narrow screens).

This mode suits “I already know which plugin can answer my question and just want to point it at the file.”

![Standard mode](../assets/screenshots/platform/mode-standard-welcome.png)

*Standard mode: a modular-shell workbench whose central tab area hosts plugin canvases, file previews, and editors; the right parameter panel updates reactively. It is the default exploration entry point.*

### 4.2 Flow mode {#_4-2-流程模式-flow}

A visual dataflow pipeline editor: palette on the left, canvas (nodes and edges) in the middle, parameter editor on the right, and result preview at the bottom. The whole graph persists as a workspace `.flow.json` file (`{ version, kind: 'ergalics-flow', graph }`, written through `src/core/vfs/`) and is opened by the file explorer's Flow editor. The old `blockGraph` project field remains readable for compatibility, and the same `.clproj` autosave and sharing pipeline is used.

#### 4.2.1 Block catalog (38 built-in blocks) {#_4-2-1-区块目录-38-个内置区块}

| Category | Count | Blocks |
| --- | --- | --- |
| Data source source | 4 | Example data, random data generation, grid generation, file loading |
| Transform transform | 5 | Select columns, rename column, add column, normalize, sort |
| Filter filter | 3 | Numeric range filter, conditional value filter, Top-K selection |
| Math math | 6 | Add, subtract, multiply, divide (column-to-column or column-to-scalar), square root, absolute value |
| Statistics stats | 14 | Summary statistics, histogram binning, one-sample / independent two-sample / paired t-tests, one-way ANOVA, Mann-Whitney U test, chi-square test of independence, correlation, Cohen's d effect size, multiple-comparison correction, Bootstrap, Monte Carlo propagation, MCMC sampling |
| Units units | 2 | Dimensional conversion (units.convert), dimensional consistency check (units.check) |
| Visualization viz | 4 | Scatter, line, histogram, 2D point cloud (plots through plugins via the render bridge) |
| Plotting plot | 4 | Line, scatter, histogram, bar (rendered by the publication-grade plotting engine) |

The division between `viz.*` and `plot.*` is deliberate: `viz.*` passes a `RenderedView` to the **plugin renderer**, using the same plugin seen in Standard mode; `plot.*` uses the **pure-TS vector engine** in `src/core/plot/` to produce publication-grade plots directly exportable as SVG / PDF. Math and statistics blocks call the pure functions in `src/core/stats` and `src/core/units` directly (see article 07). Block metadata (name, description) includes Chinese and English, resolved centrally by `src/blocks/l10n.ts`; adding a language is a data-only change.

Control-flow blocks (if/else, repeat, parallel) are deliberately deferred—the `region` seam on `BlockInstance` is in place so they can be incorporated later as extensions rather than a refactor.

#### 4.2.2 Compiler and executor {#_4-2-2-编译器与执行器}

The compiler is a pure function: structural validation (port matching, required inputs, type compatibility), cycle detection, and Kahn-style topological sorting. Errors are returned as structured `diagnostics`, which the canvas uses to draw red edges and inline diagnostic strips, without throwing exceptions throughout the process.

The executor uses node-level incremental caching and dirty-value propagation for invalidation: changing a single block's parameters re-executes only that block and its downstream nodes. Runs support cancellation and concurrent deduplication—repeated run triggers do not cause parallel execution, and cancellation actually terminates an in-progress compute node.

```mermaid
flowchart LR
    A["区块图<br/>（节点 + 连线）"] --> B["编译器（纯函数）<br/>校验 · 拓扑排序 · 诊断"]
    B -- 有错误 --> C["画布绘制红色边与诊断条"]
    B -- 通过 --> D["执行器<br/>增量缓存 · 脏值传播 · 可取消"]
    D --> E["逐节点输出缓存"]
    E --> F["渲染桥接（唯一副作用）"]
    F --> G["RenderedView 送入插件渲染器<br/>DataTable 渲染为只读表格<br/>Scalar 内联显示"]
```

#### 4.2.3 Result preview {#_4-2-3-结果预览}

The bottom preview adapts to the selected node's output type: `RenderedView` uses the existing plugin renderer (scatter, histogram, etc.); the `svg-plot` vector view emitted by a `plot.*` block renders a standalone SVG in place and can be exported directly as SVG / PDF; `DataTable` output (such as the binning results of `stats.summary` and `stats.histogram`) renders as a read-only table, making non-visual outputs visible too; `Scalar` displays inline. When a pipeline has multiple outputs, a chip switcher selects the node to inspect.

![Flow mode](../assets/screenshots/platform/mode-flow.png)

*Flow mode: connect data source / transform / statistics / visualization blocks into a DAG pipeline, then execute incrementally after compilation and preview in place.*

#### 4.2.4 Sample pipelines {#_4-2-4-示例管线}

Eight Flow sample projects are stored as real `.clproj` files in `examples/projects` (the same directory also contains three plugin demonstration projects; see article 01). They are discovered at build time via `import.meta.glob`; adding a sample only requires adding the file and registering it in the metadata table:

| Sample | Topic |
| --- | --- |
| block-01-signal-analysis | Signal analysis |
| block-02-random-distribution | Random distribution |
| block-03-grid-scatter | Grid scatter |
| block-04-range-filter | Range filter |
| block-05-dual-pipeline | Dual-pipeline comparison |
| block-06-topk-pipeline | Top-K selection |
| block-07-binning-stats | Binning statistics |
| block-08-normalize-grid | Normalized grid |
| crystal-lattice-demo | Crystal lattice demo |
| particles-demo | Particles demo |
| point-cloud-demo | Point-cloud demo |

All eight Flow examples execute through the shared IR interpreter and are individually verified by the `examples-roundtrip` unit test.

### 4.3 Block mode (Blockly) {#_4-3-积木模式-blockly}

A Scratch-like block editor for learners and users wanting an imperative experience. The green “运行时” hat block is the only execution entry point; orphan blocks not connected beneath the hat never run, fundamentally preventing “accidental execution of broken code.” Forty built-in blocks are organized into ten categories:

| Category | Blocks |
| --- | --- |
| Start | Run-time hat block (sole entry) |
| Data | Load CSV, load XYZ, random, range, list, list indexing |
| Variables | Assignment and retrieval |
| Operators | Number / text / boolean / null literals, arithmetic, comparison, logic, unary |
| Transform | Normalize, sort, select columns, filter, add column |
| Statistics | Summary, histogram |
| Plot | Scatter, line, histogram, point cloud |
| Control flow | If, repeat, while loop, for each, break, continue |
| Functions | Define, return, call |
| Utilities | Print, raw text |

![Block mode](../assets/screenshots/platform/mode-block.png)

*Block mode: a Scratch-like canvas starts a script with a hat block; the assembled blocks compile to shared IR for execution.*

Technical points:

- Blockly 13 drives the canvas and is a lazily loaded chunk (about 828 KB), so it does not affect the initial screen of Standard and Flow modes; media assets are vendored on the same origin and do not depend on a CDN.
- Block names, hints, dropdown options, and toolbox categories are localized through Blockly's `BKY_*` key system. A language change rebuilds the workspace with relabeled blocks, verified by a dedicated unit test (`tests/editor/block-i18n.test.ts`).
- The Run button provides three cards: live result preview, variable panel, and console panel.
- Five built-in sample programs (galaxy scatter plot, temperature line plot, random histogram, normalized scatter, looped greeting) live in `src/editor/block/samples.ts` and load through the top-bar “示例” dialog.
- After a block graph compiles to shared IR, the built-in interpreter executes it and calls the same Studio API as Code mode.

### 4.4 Code mode (Monaco · Python / R / JavaScript) {#_4-4-代码模式-monaco-·-python-r-javascript}

A real script editor. The toolbar provides a **Python / R / JS** segmented language switch and an engine badge explicitly showing what will execute the current buffer.

| Language | Execution engine | Description |
| --- | --- | --- |
| Python | Full CPython in a Pyodide Web Worker | Free-form syntax (comprehensions, f-strings, importable packages); `studio` is injected as a proper importable module; supports REPL single-expression evaluation |
| R | Vendored webR 0.6.0 runtime (`public/webr/`, falling back to the IR engine when assets are missing) | Prefer execution by a real R interpreter; fall back to the shared IR engine when webR assets are missing or the `studio.*` bridge degrades; `<-` assignment |
| JavaScript | In-process IR engine | The buffer is parsed to shared IR and executed by the same interpreter as Block mode; `const/let/var` declarations |

Shared capabilities:

| Capability | Behavior |
| --- | --- |
| Consistent studio interface across languages | `load / random / range / exampleData / grid / normalize / sort / select / addColumn / addConstantColumn / filter / filterRange / topK / renameColumn / summary / histogram / plot / print / notify / getParam / setParam`. `studio.plot(...)` reaches exactly the same plugins as Flow-mode `viz.*` blocks via the render bridge. |
| One-click language translation | Switching language tabs opens a “语言切换预览” floating dialog with an editable reference translation in an embedded Monaco editor. Edit the translation and click “应用” to use the new language, click “放弃并清空” to start blank, or “取消” to stay in the original language. After discard-and-clear, an “撤销清空” notice allows one-click restoration of the previous code. A clearing guard prevents a nonempty buffer from being silently cleared when translation is empty; only an explicit “放弃并清空” clears it through a one-time allow flag. |
| Interrupt | Stopping execution terminates and restarts the Worker so runaway loops cannot freeze the page; the Worker's bootstrap URL and bootstrap Promise are memoized, avoiding repeated initialization on restart. |
| Shortcut | `Ctrl/⌘ + Enter` runs the buffer (and stops an in-progress Python task); keyboard input is debounced for 150 ms before syncing to IR, keeping Block and Flow up to date while typing. |
| Explicit DSL boundary | Statements that R / JS parsers cannot model are kept as raw-code nodes, skipped at runtime, and reported once as a count in the console; full syntax is always available in the Python tab. |

| Method | Description |
| --- | --- |
| load | Load a project data file as a table |
| random / range / exampleData / grid | Generate random numbers, integer sequences, built-in examples, and grid data |
| normalize / sort / select / addColumn / addConstantColumn / filter / filterRange / topK / renameColumn | Table transforms |
| summary / histogram | Summary statistics and binning |
| plot | Plotting (through the render bridge to the plugin renderer) |
| print / notify | Console output and notifications |
| getParam / setParam | Read/write project parameters |

Nine sample programs are stored as real files in `examples/code` (EDA pipeline, Monte Carlo circle estimation, signal analysis, telemetry exploration, galaxy scatter, random histogram, range loop, add-column plotting, normalize and filter) and loaded through the “示例” dialog.

![Code mode](../assets/screenshots/platform/mode-code.png)

*Code mode: Monaco editor + console / variable panels; Python runs in a Pyodide Worker with the `studio` module injected.*

### 4.5 Conversion among three modes (shared IR) {#_4-5-三模式互转-共享-ir}

IR (`src/editor/ir`, including validation, hashing, and serialization) is the single source of truth for Block, Flow, and Code modes; each mode has pure-function round-trip conversions to and from IR:

| Conversion | Module |
| --- | --- |
| IR ↔ Flow DAG | `src/editor/flow/convert.ts` (irToFlow, flowToIR, Kahn topological sort, parameters aligned 1:1 with the block catalog) |
| Blockly JSON ↔ IR | `src/editor/block/convert.ts` |
| Parse code buffer back to IR | `src/editor/code/parse.ts` (unparseable lines retained as raw-code nodes) |
| Generate code from IR | `src/editor/codegen` (Python, R, JS generators) |
| Interpret IR directly | `src/editor/runtime/interpreter.ts` (calls the same Studio API as Flow blocks) |

```mermaid
flowchart TD
    IR["共享 IR<br/>（校验 · 哈希 · 序列化）"]
    FL["流程模式 DAG"] <--> IR
    BL["积木模式 Blockly JSON"] <--> IR
    CD["代码模式缓冲区<br/>Python / R / JavaScript"] -- 代码解析 --> IR
    IR -- 代码生成 --> CD
    IR -- 解释执行 --> SA["Studio API<br/>load · transform · stats · plot"]
    SA --> RB["插件渲染桥接"]
```

Build a pipeline in Flow mode, switch to Block to see the same logic as blocks, and jump to Code to see generated Python; the reverse also works. Flow edits are **merged** into IR rather than flattening it (`mergeFlowIR`): print / loop / if / function statements remain in place and only DAG nodes are replaced. The graph-signature guard in `src/stores/useFlowSync.ts` ignores debounced echoes produced by hydration so repeated mode switches do not lose nodes.

Code generators handle target-language dialect differences: the Python generator outputs real Python syntax, the R generator handles R conventions (loop syntax, truth literals, integer division, logical operators, etc.), and the JS generator outputs directly evaluable scripts.

Round-trip consistency is pinned by unit tests including `sync-threeway`, `flow-convert`, `editorStore`, `examples-roundtrip`, and `roundtrip-all-langs` (free round trips among Python / R / JavaScript), and verified by the `verify-lang-modes` end-to-end suite using a real browser for R/JS editing, R→JS translation, a lossless Flow ⇄ Block ⇄ Code cycle, and real pipeline execution.

## Chapter 5. Research toolset {#第五章-科研工具集}

### 5.1 Unified registry {#_5-1-统一注册表}

`src/pages/research/toolRegistry.ts` is the toolset's **single source of truth**: each standalone research interface is declared once and consumed by the `/studio` route, top-bar launcher, and welcome-page launch grid. Adding a tool costs “one registry record + two i18n keys for title and description”; no routing, navigation, or launcher changes are required.

```mermaid
flowchart TD
    R["toolRegistry.ts<br/>RESEARCH_TOOLS（26 条）"]
    R --> A["App.tsx：/studio/:toolId 单条路由<br/>+ 26 条旧路径重定向"]
    R --> B["顶栏启动器 ResearchLauncher<br/>最近使用 + 分组 + 搜索"]
    R --> C["欢迎页启动网格 ToolGrid<br/>GRID_TOOLS（25 个）"]
    A --> D["StudioToolPage<br/>Suspense 骨架 · 项目门禁"]
    D --> E["ToolShell 统一外壳<br/>返回 · 图标名称 · 语言主题 · StatusBar"]
    E --> F["lazy 加载的工具页面"]
    F --> G["src/core 领域内核"]
```

Fields of a `ResearchTool` record:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier and the path segment in `/studio/<id>` |
| `path` | Canonical route `/studio/<id>`, derived from id |
| `legacyPath` | Pre-redesign hash path (default `/<id>`), retained as a client-side redirect so old bookmarks remain valid |
| `icon` | `ToolIconKind` icon type |
| `titleKey` / `descKey` | i18n keys; description defaults to `tool.<id>.desc` |
| `group` | One of six discipline groups |
| `inGrid` | Whether shown in the welcome launch grid and top-bar launcher (default yes) |
| `requireProject` | Whether to render the `EmptyProject` gate when no project is active (default no) |
| `component` | Page component wrapped in `React.lazy`, one separate chunk per tool |

Related exports: `GRID_GROUPS` (display order of six groups), `GRID_TOOLS` (the grid subset, 26 minus 1 = **25**), `getTool(id)`, `TOOLS_BY_LEGACY_PATH`, and `openToolEmbedded` (open the tool in the central canvas of Standard mode: switch to Standard, record the embedded tool id in appStore, and navigate to `/workbench` if needed).

**Routing.** `App.tsx` declares only six explicit routes: `/` (welcome), `/workbench`, `/studio/:toolId` (all research tools), `/settings`, `/plugin/:pluginId`, and `/share/:payload`; everything else falls back to welcome. Redirects for 26 legacy paths are **generated automatically** from `RESEARCH_TOOLS` at module load, so their number always matches the registry and no manually maintained redirect table exists. The app uses `HashRouter`, so deep links look like `#/studio/uncertainty`.

**Project gate.** `StudioToolPage` does three things: provide a `Suspense` skeleton for lazy pages; restore the most recent project **once** on deep links or cold starts (matching the workbench); and, for tools declaring `requireProject`, render `EmptyProject` with explicit “new / open” actions when no project is active, instead of automatically creating an empty project and surprising users arriving through deep links. An unknown `toolId` renders `EmptyState` (“tool does not exist”), rather than a blank page or error.

**Shell.** All tool pages share `ToolShell`: the top has a return-to-workbench action, tool icon and name (with an optional tool-specific action area on the right), plus settings, language, and theme controls; the body contains the tool's content (centered column, page-level scrolling); the bottom uses the same persistent `StatusBar` as the workbench, showing GPU / WASM / storage status and frame rate. Tabs embedded in the workbench central area are determined by route and render only the tool body and a compact action bar (the workbench supplies the top and status bars), for a consistent experience. Visiting a tool page itself counts as recent use for launcher ordering.

### 5.2 26 tools in six groups {#_5-2-六个分组的-26-个工具}

The discipline groups are mutually exclusive and exhaustive. The following is the complete registry list (names and purposes are taken from the actually published Chinese i18n text):

| Group | Tool id | Name | Route | Purpose | Requires project |
| --- | --- | --- | --- | --- | --- |
| **Measurement and evaluation** (2) | `uncertainty` | Uncertainty suite | `/studio/uncertainty` | Bootstrap / Monte Carlo propagation / MCMC confidence intervals and convergence diagnostics | |
| | `profiler` | Data profiler | `/studio/profiler` | Column profiling, correlation matrix, quality score and issue list | |
| **Modeling and inference** (4) | `model-lab` | Model workbench | `/studio/model-lab` | OLS / logistic / ridge / polynomial regression + coefficient tables + residual diagnostics | |
| | `inference` | Bayesian inference | `/studio/inference` | HMC/NUTS Bayesian inference + WAIC/LOO/PPC | |
| | `model-inference` | Model inference | `/studio/model-inference` | In-browser WebGPU inference for ONNX models | |
| | `sweeps` | Parameter sweeps | `/studio/sweeps` | Grid / list / Latin hypercube sweeps + response surface | ● |
| **Data and lineage** (6) | `sql` | SQL data workbench | `/studio/sql` | Run DuckDB-WASM SQL directly against project data files | ● |
| | `lineage` | Data lineage | `/studio/lineage` | File → run DAG lineage graph | |
| | `figures` | Figure workbench | `/studio/figures` | Figure Studio publication-grade multi-panel figures | ● |
| | `analysis` | Data analysis | `/studio/analysis` | Quick plots + descriptive statistics + t / Mann–Whitney tests | |
| | `cleaning` | Data cleaning wizard | `/studio/cleaning` | Guided table transformation, cleaning, and deduplication | ● |
| | `files` | File explorer | `/studio/files` | Browse directories and file contents in the project workspace VFS | ● |
| **Signals and records** (3) | `signal` | Signal lab | `/studio/signal` | FFT / Welch PSD / window functions / Savitzky–Golay / ACF-PACF / seasonal decomposition | ● |
| | `notebook` | Notebook | `/studio/notebook` | Reproducible experiment records with Markdown + Python cells | ● |
| | `runs` | Experiment records | `/studio/runs` | Run history ledger, automatic recording, and A/B comparison | |
| **Reporting and reproduction** (5) | `report` | Report builder | `/studio/report` | Narrative + figures + tables + interactive filters → self-contained HTML | ● |
| | `reprolock` | Reproducibility lock | `/studio/reprolock` | repro.lock import/export + drift checks + one-click reproduction | |
| | `supplement` | Supplement packaging | `/studio/supplement` | Paper-attachment ZIP: manifest + runs + lineage + data/code + optional repro.lock | |
| | `course` | Course mode | `/studio/course` | Assign, collect, and grade work offline | ● |
| | `gallery` | Project gallery | `/studio/gallery` | Browse and reopen reproducible work | |
| **Toolbox** (6) | `unit-convert` | Unit conversion | `/studio/unit-convert` | Convert units for common physical dimensions | |
| | `calc` | Calculator | `/studio/calc` | Scientific calculator | |
| | `format-convert` | Format conversion | `/studio/format-convert` | Convert data file formats | |
| | `sigfig` | Significant figures | `/studio/sigfig` | Round and represent significant figures | |
| | `molar-mass` | Molar mass | `/studio/molar-mass` | Calculate molar mass from chemical formulas | |
| | `quick-stats` | Quick statistics | `/studio/quick-stats` | Paste-and-calculate descriptive statistics | |

Total: measurement and evaluation 2 + modeling and inference 4 + data and lineage 6 + signals and records 3 + reporting and reproduction 5 + toolbox 6 = **26**. Nine require a project (`sweeps`, `sql`, `figures`, `signal`, `notebook`, `report`, `course`, `cleaning`, `files`). `analysis` is excluded from the launch grid (`inGrid: false`) because it also has a separate workbench top-bar button, avoiding duplicate entries. All six toolbox tools work without a project.

#### 5.2.1 Measurement and evaluation {#_5-2-1-测量与评估}

- **Uncertainty suite (`uncertainty`)** turns “how certain is this number?” into something computable. It provides Bootstrap confidence intervals, Monte Carlo propagation, and MCMC sampling, with convergence diagnostics including R-hat, effective sample size ESS, HDI, and MCSE. When the sample size is large enough it automatically switches to a WGSL GPU engine (one workgroup per chain); below the threshold or without a device it falls back to CPU. With the same random-number sequence, results agree within numerical tolerance (kernel details in article 07).

![Uncertainty suite: Bootstrap confidence interval](../assets/screenshots/platform/laboratory/uncertainty-bootstrap.png)

*The uncertainty suite produces percentile confidence intervals with Bootstrap resampling, combining Monte Carlo propagation and MCMC with diagnostics such as HDI, R-hat, ESS, and MCSE.*

- **Data profiler (`profiler`)** examines data health in one streaming pass: numeric columns use Welford's recurrence for exact mean and variance, reservoir sampling for quantiles and MAD, and modified z-scores to mark outliers; text columns use HyperLogLog for cardinality estimation and Space-Saving for Top-K. At table level it provides Pearson / Spearman correlation and duplicate rate, combining them into a deterministic 0–100 quality score and issue list, cached by content fingerprint for reopening.

![Data profiler: correlation matrix and column quality report](../assets/screenshots/platform/laboratory/data-profiler.png)

*The data profiler produces a correlation matrix, column histograms and missing-value statistics for a CSV, combining them into a deterministic 0–100 quality score and issue list.*

#### 5.2.2 Modeling and inference {#_5-2-2-建模与推断}

- **Model workbench (`model-lab`)** handles fitting and diagnostics. It supports ordinary least squares (Householder QR), logistic regression (IRLS), ridge regression (K-fold cross-validation for parameter selection), and polynomial fitting. It produces a coefficient table with estimates, standard errors, p-values and confidence intervals, plus a 2×2 residual diagnostic figure (residuals–fitted, QQ, scale–location, residuals–leverage), and supports side-by-side comparison of multiple models.

![Model workbench: OLS fit and residual diagnostics](../assets/screenshots/platform/laboratory/model-lab.png)

*The model workbench fits linear models with 2×2 residual diagnostics (residuals–fitted, QQ, scale–location, residuals–leverage); the coefficient table includes estimates, standard errors, p-values and confidence intervals.*

- **Bayesian inference (`inference`)** is Inference Forge. It provides HMC / NUTS samplers (NUTS uses a U-turn criterion and Dual Averaging step-size adaptation, so no manual step count is required), declarative likelihood templates with weak priors scaled to the data, posterior diagnostics including R-hat and bulk / tail-ESS, and WAIC / PSIS-LOO model comparison.

![Bayesian inference: in-browser NUTS sampling and posterior diagnostics](../assets/screenshots/platform/laboratory/inferenceforge-posterior.png)

*Inference Forge runs NUTS sampling in the browser (WebAssembly) and provides a complete convergence picture: posterior summaries with 94% HDI, MCSE, R-hat and ESS, per-chain diagnostics, WAIC / PSIS-LOO model comparison, posterior predictive checks, and trace and posterior-density plots.*

- **Model inference (`model-inference`)** brings trained models into the browser: run an ONNX model with WebGPU and inspect inference results, for cases where “the model is trained elsewhere and the conclusion must be reproduced here.”

![Model inference: in-browser ONNX sentiment classification](../assets/screenshots/platform/laboratory/model-inference.png)

*Model inference runs an ONNX sentiment classifier with WebGPU in the browser and reports per-sample predictions, confidence, and end-to-end latency.*

- **Parameter sweeps (`sweeps`)** use `expandPlan` to expand a sweep plan into deterministic design points: all-grid / list axes use the full Cartesian product, while all Latin hypercube axes use stratified sampling by dimension. Plans mixing lhs and grid are explicitly rejected because sample count has no unambiguous definition in that case. A response surface is available after execution.

![Parameter sweeps: sweep plan configuration](../assets/screenshots/platform/laboratory/parameter-sweeps.png)

*Parameter sweeps expand plans into deterministic design points (full grid / Latin hypercube stratified sampling by dimension); the response surface can be viewed after execution.*

#### 5.2.3 Data and lineage {#_5-2-3-数据与谱系}

- **SQL data workbench (`sql`)** uses DuckDB-WASM, lazy-loaded on first use. Project data files are registered in DuckDB's virtual file system and exposed directly as tables, so SQL can query files in `.clproj`. Queries support timeouts and `AbortSignal`; aborting or timing out terminates the Worker and discards the singleton, rebuilding it on the next call so a runaway query cannot overwhelm the page.
- **Data lineage (`lineage`)** connects project files (sources) to runs (transformations) by file id on run records and draws a Sugiyama-style layered DAG (longest-path layering, single-pass barycenter ordering, centered rows). The domain layer has no React / store / DOM dependencies, and the canvas is independently testable.
- **Figure workbench (`figures`)** creates publication-grade multi-panel figures. `FigureSpec` is a multi-panel container on a journal-template grid (IEEE / Elsevier column widths, colorblind-friendly palette); `composeFigure` renders one standalone SVG (nested panel viewports and a / b / c labels); `exportFigure` handles SVG / PDF / PNG-600dpi downloads. Composition only resizes and never modifies the original `PlotSpec`.

![Figure workbench: a 2×3 mode-field figure on the IEEE single-column template](../assets/screenshots/platform/laboratory/figurestudio-em.png)

*The figure workbench arranges a 2×3 eigenvalue mode-field figure on an IEEE single-column template, with per-panel layout, shared color scale, pre-submission checks, and SVG / PDF / 600dpi PNG export.*

- **Data analysis (`analysis`)** is a general entry point for hypothesis tests, correlation and basic statistics: the t-test family, one-way ANOVA, Mann-Whitney U, chi-square test of independence, Cohen's d, and Bonferroni and Benjamini-Hochberg multiple-comparison corrections. Results can be rendered directly as publication-grade Chinese and English sentences.
- **Data cleaning wizard (`cleaning`)** provides step-by-step guidance. Its step model contains five serializable operation types: type conversion, missing-value policy (delete / mean / median / zero / forward fill), outlier marking (IQR / z-score), deduplication, and column renaming. No step ever rewrites the input table, so users can advance, go back, jump, or “undo this step”; the quality expectation contract is provided by `data-quality` (see article 07).

![Data cleaning wizard: stepwise type-conversion preview](../assets/screenshots/platform/laboratory/data-cleaning.png)

*The cleaning wizard uses step cards for type conversion, missing-value handling, deduplication, and column renaming, previewing before/after differences at each step without rewriting the original table.*

- **File explorer (`files`)** answers “where are my run records, figures and scripts stored?” It directly browses the project workspace through the Git-independent VFS (`src/core/vfs/`): a lazily loaded directory tree on the left and previews with downloads for UTF-8 text (md / txt / json / csv / code, etc.) on the right; other files are treated as binary. The page also includes a static directory guide to the standard project skeleton (`project.clproj`, `runs/`, `figures/`, `data/`, `code/`, `manuscript/`, `.ergalics/`, `.git/`, etc.), with one-line descriptions.

#### 5.2.4 Signals and records {#_5-2-4-信号与记录}

- **Signal lab (`signal`)** handles spectra, filtering and time-domain processing. It offers radix-2 FFT and amplitude spectra (mathematically consistent with the GPU `fftKernelWGSL`), Hann / Hamming / Blackman and other windows, Welch power spectra, Savitzky-Golay smoothing and moving averages, autocorrelation ACF and partial autocorrelation PACF, and classical additive time-series decomposition x = trend + seasonality + residual. Filtered columns can be saved back as derived project files and automatically enter the lineage graph.

![Signal lab: Welch PSD power spectrum of a vibration signal](../assets/screenshots/platform/laboratory/signallab-psd.png)

*The signal lab analyzes an acceleration time series: the Welch PSD (rectangular window, nfft=256, 7 segments) has a main peak around 0.02 Hz with harmonics. It supports FFT amplitude spectra / windows / filtering and time-domain processing, and can send plots to Figure Studio or save them back to project files.*

- **Notebook (`notebook`)** is a reproducible experiment record mixing Markdown and Python cells. Execution uses the same Pyodide runtime as Code mode, so notebooks and scripts see the same `studio` API; the cell list is persisted in `project.state.notebook`.
- **Experiment records (`runs`)** form a run ledger across all tools. Every execution of Flow, Block, Code, notebook, sweeps, uncertainty, modeling, and inference automatically leaves a durable snapshot (parameters, metrics, duration, source), with metric differences and paired A/B comparison. Records live in IndexedDB's `runs` store and are **not** written into `.clproj`, keeping project files small; they are cleaned up when the project is deleted.

#### 5.2.5 Reporting and reproduction {#_5-2-5-报告与复现}

- **Report builder (`report`)** uses `buildReport` to build ordered sections (headings, Markdown, figures from the figure workbench, data tables, run summaries, interactive filters) into **one self-contained HTML file**: inline CSS, inline SVG, inline JSON data, and a zero-dependency native-JS controller. All user strings are escaped first; embedded JSON is emitted as `<script type="application/json">` with `<` Unicode-escaped to prevent `</script>` payload escape, so the report can safely be sent directly to others.

![Report builder: interactive HTML report](../assets/screenshots/platform/laboratory/report-builder.png)

*The report builder combines headings, multi-panel figures, data tables and run summaries into one self-contained HTML file with a zero-dependency controller, suitable for safe delivery.*

- **Reproducibility lock (`reprolock`)** exports and validates `repro.lock`: data fingerprints, parameter hashes, seeds and code snapshots support five categories of drift checking and one-click reruns. An environment snapshot (version, platform, kernel availability) is also included so it is clear whether drift occurred in data or environment.

![Reproducibility lock: checking five categories of fingerprint drift](../assets/screenshots/platform/laboratory/reproducibility-lock.png)

*The reproducibility lock checks data fingerprints, parameter hashes, seeds and code snapshots and includes an environment snapshot to determine whether drift occurred in data or environment.*

- **Supplement packaging (`supplement`)** uses fflate to package `manifest.json` (project metadata, run records, lineage graph, author and license forms), optional raw data files and code sessions, and an optional repro.lock into a ZIP researchers upload with a paper.

![Supplement packaging: manifest, data and code in a ZIP](../assets/screenshots/platform/laboratory/supplementary-materials.png)

*Supplement packaging uses fflate to bundle the manifest, raw data and code sessions into a ZIP for uploading with a paper.*

- **Course mode (`course`)** is a local-first teaching loop: a teacher creates a course (identified by a local identity string, with no account system) and publishes assignments bound to discipline templates; students claim tasks, work in projects and submit `repro.lock` snapshots of run results; the teacher views a student × assignment matrix, records grades and comments, and exports the whole class as a package with one directory per student. Data is persisted in IndexedDB's `courses` store.

![Course mode: teacher and student interfaces](../assets/screenshots/platform/laboratory/course-mode.png)

*Course mode implements a local-first loop of teacher assignments, student repro.lock snapshot submissions, grading, and class-wide export.*

- **Project gallery (`gallery`)** uses local “My Shares” storage (localStorage) to record metadata for shared work and sanitized snapshot HTML, allowing details dialogs to reopen offline. v1 uploads nothing; delisting only marks the item (preserving an audit trail) and filters it from all lists.

![Project gallery: reproducible works organized by discipline](../assets/screenshots/platform/laboratory/workgallery-gallery.png)

*The gallery displays reproducible works by discipline, each marked with topic, reproducibility-lock state (locked / drift detected / unlocked), author and license for discovery and citation.*

#### 5.2.6 Toolbox {#_5-2-6-工具箱}

Six lightweight tools, none requiring an open project, cover common small research tasks:

- **Unit conversion (`unit-convert`)** converts units for common physical dimensions using the same conversion kernel as the global unit system (see chapter V).

![Unit conversion: all length conversions from meters](../assets/screenshots/platform/laboratory/unit-convert.png)

*Unit conversion produces a table converting length in meters to all common units.*

- **Calculator (`calc`)** is a scientific calculator supporting expression evaluation.

![Scientific calculator: expressions and physical constants](../assets/screenshots/platform/laboratory/calc.png)

*The scientific calculator evaluates an expression containing physical constants and displays the result.*

- **Format conversion (`format-convert`)** converts among supported tabular and scientific data formats.

![Format conversion: CSV→JSON interface](../assets/screenshots/platform/laboratory/format-convert.png)

*Format conversion works between CSV, JSON and other tabular and scientific data formats.*

- **Significant figures (`sigfig`)** rounds and represents values according to significant-figure rules.

![Significant figures: rounding and scientific notation](../assets/screenshots/platform/laboratory/sigfig.png)

*Significant figures applies rounding rules and expresses the result in scientific notation.*

- **Molar mass (`molar-mass`)** computes molar mass from a chemical formula.

![Molar mass: NaCl at 58.44 g/mol and elemental proportions](../assets/screenshots/platform/laboratory/molar-mass.png)

*Molar mass calculates 58.44 g/mol from NaCl and lists elemental proportions.*

- **Quick statistics (`quick-stats`)** calculates descriptive statistics such as mean and standard deviation from a pasted column, with one-click access to the uncertainty suite for interval estimation.

![Quick statistics: paste for mean/SD/confidence interval](../assets/screenshots/platform/laboratory/quick-stats.png)

*Quick statistics computes mean, SD and confidence intervals from a pasted column.*

### 5.3 Entry points and navigation {#_5-3-入口与导航}

The same registry drives several entry points with consistent behavior:

| Entry | Behavior |
| --- | --- |
| Welcome launch grid (`/`, `ToolGrid`) | Displays 25 tool cards in six groups with a filter box; searching flattens groups into one list. Clicking records use and opens the tool embedded in the workbench central area through `openToolEmbedded`. |
| Top-bar research launcher (“科研▾” in the workbench, `ResearchLauncher`) | A “recently used” group at the top (latest 3, with badges), then all tools grouped by discipline; each shows an icon, name and one-line description so it can be recognized before opening. Supports filtering and full keyboard navigation. Selection opens the tool embedded in the workbench central area by default. |
| Command palette and sidebar | Both consume the registry and open selected tools embedded. |
| Legacy redirects | Pre-redesign bookmarks such as `#/uncertainty` are sent to `#/studio/uncertainty` by automatically generated redirects. |
| Standalone full page | Any tool can be opened as a standalone page through the right panel's “独立页面打开” action or a `/studio/<id>` deep link; its shell is consistent with the embedded state. |

Recent use is maintained by `src/core/recentTools.ts` in localStorage (key `ergalics:recent-tools`), retaining at most 8 entries while the UI displays only the first 3—the extra room prevents trimming from ever leaving an empty slot.

### 5.4 Flow between tools {#_5-4-工具之间的流转}

Tools are separate pages, but **not islands**. They collaborate through three shared channels, which is the practical reason for placing all 26 capabilities under one registry:

```mermaid
flowchart LR
    DF["项目数据文件<br/>（dataFiles 注册表）"]
    DF --> T1["工具 A"]
    T1 -- "派生输出回写项目" --> DF
    T1 -- "PlotSpec 交接" --> FS["图表工作台<br/>Figure Studio"]
    T1 -- "运行记录" --> RUN["实验记录<br/>（IndexedDB runs）"]
    RUN --> LIN["数据血缘"]
    FS --> REP["报告生成器"]
    RUN --> REP
    LIN --> REP
    REP --> SUP["补充材料打包"]
    RUN --> RL["可复现锁"]
    RL --> SUP
```

| Channel | Mechanism |
| --- | --- |
| Shared data-file registry | `src/core/dataFiles.ts` gives project-owned files, built-in examples and Code mode `_FILES` the same resolution logic. `src/pages/research/researchUi.ts` is thin glue above this layer (no React dependency), responsible for “load a table and identify numeric columns,” “send a PlotSpec to the figure workbench,” and “assemble derived output as CSV and save it back to the project.” Thus cleaning results can be read directly in the signal lab, and filtered columns can then be fitted in the model workbench. |
| PlotSpec handoff | Every tool's plot uses the same `PlotSpec` structure and can be received by the figure workbench as one panel, reusing journal templates, panel labels and vector export. Research-grade workbench plugins likewise use “Send to Figure Studio” to push multi-panel figures into the figure workbench (see article 03). |
| Experiment records as backbone | Every execution enters the `experiment` ledger; lineage uses it to connect files and runs into a DAG; the report builder then takes run summaries from it. Reproducibility in the toolset is therefore not a few isolated features, but a data flow spanning every tool. |

### 5.5 Supporting kernels {#_5-5-配套内核}

Under the tool pages is a set of domain kernels (`src/core/`) decoupled from specific tools and reused by multiple tools and plugins:

- **Unit system (`units`)**: the Quantity / convert / check trio constructs dimensional quantities, performs dimension-safe conversions, and checks unit consistency. The unit-conversion tool and plugins needing units share the implementation.
- **Chunked reading (`chunked`)**: row-window reading and content fingerprints for large files, providing a memory-conscious ingestion path for profiling, cleaning and file routing.
- **Figure engine (`figure`)**: a `FigureSpec` multi-panel container on journal-template grids (`JOURNAL_TEMPLATES`: IEEE / Elsevier single- and double-column sizes, Okabe-Ito colorblind-friendly palette, millimeter column-width conversion); `composeFigure` outputs one standalone SVG (nested per-panel viewports + a/b/c labels), and `exportFigure` handles SVG / PDF / 600dpi PNG downloads. The figure workbench also supplies pre-submission checks, bilingual caption drafting and 3D field panels. Composition only resizes and never modifies the original `PlotSpec`.
- **Run → lineage → attachment chain**: the `experiment` ledger records parameters, metrics and duration for every execution; `lineage` connects sources and transformations into a DAG by file id; `supplement` packages manifest, run records, lineage, data and code into a paper-attachment ZIP; `repro.lock` drift checking and one-click reproduction run throughout.

### 5.6 Summary {#_5-6-小结}

The 26 tools cover the entire path from data ingestion to paper delivery: **measurement and evaluation** answers “how certain is the result”; **modeling and inference** asks “what conclusion does the data support”; **data and lineage** asks “where did the data come from and what changed”; **signals and records** asks “was the process fully recorded”; **reporting and reproduction** asks “can someone else rerun it unchanged”; and the **toolbox** handles common small tasks such as unit conversion, rounding and quick lookup. They share the same project, data files, `src/core` kernels and plugin rendering path, so context is preserved when moving from workbench to toolset or back.

For the algorithmic kernels, dependencies and export formats behind each tool, see article 07, *Scientific Computing Subsystems*. For how testing and gates constrain the run-record, lineage and reproduction chain, see article 08, *Testing and Quality Assurance*.

## Chapter 6. GPU computing and native core {#第六章-gpu-计算与原生核心}

### 6.1 Rust native core (source delivery) {#_6-1-rust-原生核心-源码交付}

`native/ergalics-core` (crate version 0.1.0, edition 2021, `crate-type = ["cdylib", "rlib"]`) targets `wasm32-unknown-unknown` and is bound to `src/native` through wasm-bindgen 0.2. WebGPU bindings depend on web-sys's experimental GPU API surface (approximately forty features explicitly enabled, including GpuAdapter, GpuDevice, GpuBuffer, GpuComputePipeline, and GpuBindGroup). Dependencies are wasm-bindgen, wasm-bindgen-futures, js-sys, web-sys, console_error_panic_hook, serde, and serde_json; the release profile enables `lto`, `codegen-units = 1`, and `opt-level = 3`. Rust source is divided into five modules by responsibility:

| Source file | Responsibility |
| --- | --- |
| lib.rs | Public exports, version query (`core_version`), and initialization |
| device.rs | GpuDeviceManager and GpuInfo: adapter and device acquisition, `webgpu_available` detection, and a CPU fallback option |
| buffer.rs | GpuBuffer: create storage / read-only / uniform buffers with explicit usage masks, upload with write, and read back through a dedicated readback buffer with read |
| compute.rs | KernelDescriptor and BindingDescriptor, ComputeKernel compilation, bind-group materialization and dispatching, and ComputeQueue wrapper |
| utils.rs | Helpers such as detect_file_kind (magic-number-based file type detection) and logging |

The crate is delivered as source with the repository and can be compiled locally; it does not participate in the production compute path. Release builds generate a placeholder module (see section V), and browser-native WebGPU performs the actual computation.

### 6.2 Host-side compute services {#_6-2-宿主侧计算服务}

`src/core/gpu.ts` owns adapter and device lifecycle: `initGpu(mode)` (supports `auto` and `cpu-fallback`, with concurrent-request coalescing and epoch guards to prevent an in-flight initialization from overriding an explicit device release), `getGpuBackend` / `resetGpu` / `subscribeGpu`. Backend state `GpuBackend` tracks availability, adapter information (vendor / architecture, etc., read through `adapter.info`), the device reference, CPU fallback flag, and out-of-memory status (`oom`, set by uncaptured device errors).

Above it, `src/core/compute.ts` is the plugin-facing compute surface (`PluginApi.gpu`): `createBuffer`, `write`, `read`, `compileKernel`, `compilationInfo`, and one-shot `run`. `getGpuCompute()` returns the compute service or `null` based on device availability; plugins fall back to CPU implementations when it is `null`. The `backend` field distinguishes execution paths: the direct native WebGPU path (`NativeCompute`, `backend = 'webgpu'`) uses `GPUDevice` directly to create buffers, compile WGSL pipelines, and dispatch, routing read-only buffers to direct `mapAsync` mapping or a `COPY_SRC → MAP_READ` readback copy according to usage. When a local build compiles a real native module, the `WasmCompute` adapter (`backend = 'wasm'`) forwards through `src/native` bindings using the same interface. Both paths expose exactly the same primitives:

```mermaid
flowchart TD
    A["插件调用 api.gpu 接口"] --> B{"原生模块含 GPU 绑定？"}
    B -- 是（本地完整构建） --> C["WASM 适配器路径"]
    B -- 否（交付构建为占位模块） --> D{"WebGPU 可用？"}
    C --> E["GPU 执行"]
    D -- 是 --> E
    D -- 否 --> F["api.gpu 为空<br/>插件回退 CPU 实现"]
```

> When WebGPU is unavailable, `api.gpu` is `undefined` and plugins fall back to CPU implementations—behavior remains consistent and no GPU is required.

This design makes accelerated computing available in both development and production: direct browser-native WebGPU is the actual compute path in release builds, and each built-in plugin's CPU fallback uses an implementation mathematically consistent with the GPU kernel.

### 6.3 Reusable WGSL kernels {#_6-3-可复用-wgsl-内核}

`src/core/wgsl.ts` contains reusable WGSL compute kernels and host-side packing / unpacking helpers mathematically consistent with the kernels for CPU fallback (such as `packParticles` / `unpackParticles` / `advanceParticleCPU`, `packBodies` / `unpackBodies` / `advanceNBodyCPU` and `nbodyTotalEnergy`, and `histogramCPU`). There are currently **14 kernels**:

| Kernel | Mathematics | Primary users |
| --- | --- | --- |
| particleKernelWGSL | Interleaved [x, y, vx, vy] single-buffer integration | Particles plugin |
| nbodyKernelWGSL | Direct O(N²) summation for 3D all-pairs gravity | N-Body gravity plugin |
| histogramKernelWGSL | Bin counts + logarithmic scale | Histogram plugin and statistics blocks |
| heatmapKernelWGSL | Grid scalars to color mapping (viridis stops) | Heatmap plugin |
| pointCloudKernelWGSL | Point-cloud projection and density output | Point-cloud plugin, million-point enhancement |
| fluidCollideKernelWGSL | D2Q9 lattice Boltzmann collision | Fluid plugin |
| fluidStreamKernelWGSL | D2Q9 streaming | Fluid plugin |
| fluidCurlKernelWGSL | Vorticity calculation (vortex street visualization) | Fluid plugin |
| waveKernelWGSL | 2D wave-equation leapfrog time stepping | Wave-equation plugin |
| matmulKernelWGSL | Tiled matrix multiplication (TILE = 16) | Linear algebra acceleration in domain kernels |
| fftKernelWGSL | Stage-wise radix-2 FFT (maximum N = 4096) | Signal lab |
| kmeansKernelWGSL | K-means assignment and centroid accumulation | Data profiling and clustering |
| binningKernelWGSL | Key-value bin aggregation (sum / mean / count) | Binning statistics and sweeps |
| spmvKernelWGSL | Sparse matrix–vector multiplication (CSR row-wise) | Host-side sparse linear algebra kernel library (no built-in plugin calls it directly yet; em-eigensolver instead solves with NumPy on Pyodide) |

Two typical kernel invocation paths:

1. **Single-buffer path** (particles demo): upload interleaved data and uniform parameters, dispatch the WGSL integrator, read back results, and report actual GPU time.
2. **Ping-pong buffer path** (N-Body, fluid, and wave-equation demos): paired buffers alternate reads and writes; every integration step stays entirely on the device, with no per-step readback overhead.

Step-by-step flow using N-Body as an example:

```mermaid
flowchart LR
    A["上传天体初始状态<br/>（位置 + 质量）"] --> B["创建两份存储缓冲"]
    B --> C["编译全对引力内核"]
    C --> D["步进：ping 缓冲算力<br/>写入 pong 缓冲"]
    D --> E["交换 ping 与 pong"]
    E -- 继续 --> D
    D -- 停止 --> F["一次性读回<br/>交给 Three.js 渲染"]
```

![N-Body gravity](../assets/screenshots/plugins/nbody-3d.png)

*N-Body gravity all-pairs summation on the GPU: 3D gravitational trajectories of several bodies orbiting a central mass, computed by a WGSL kernel and read back once for Three.js rendering.*

![Lattice Boltzmann fluid around an airfoil](../assets/screenshots/plugins/lbm-fluid.png)

*Lattice Boltzmann fluid: WGSL derives the three D2Q9 collision / streaming / vorticity kernels at compile time and computes them step by step; the flow around the airfoil and Kármán vortex street are clearly visible. Small workloads automatically fall back to CPU.*

#### 6.3.1 Engine selection and data-size thresholds {#_6-3-1-引擎选择与数据规模阈值}

The GPU's benefit comes from compute power, but upload and readback have fixed overhead, so small datasets can be slower on GPU. `src/core/gpu-kernels.ts` therefore provides a unified dispatch layer and data-size thresholds; in `auto` mode, workloads below a threshold automatically use CPU:

| Kernel | Threshold unit | Threshold |
| --- | --- | --- |
| matmul | Output element count (m × n) | 16384 (128 × 128) |
| fft | Complex sample count | 1024 |
| kmeans | Point count | 2048 |
| binning | Row count | 10000 |
| spmv | Nonzero element count (nnz) | 65536 |

Kernel descriptor binding layouts come directly from the `*_BINDINGS` constants in `wgsl.ts`, preventing drift between host descriptors and shader text. Threshold checks also incorporate live device availability (`getGpuBackend()`). On top of this, `src/core/pointcloud-gpu.ts` provides budget control, deterministic downsampling, and a WebGPU height-coloring kernel for million-point clouds; `src/core/mesh3d.ts` provides a pure-function implementation of the 3D mesh data pipeline (shared by surface/volume plugins).

#### 6.3.2 Uncertainty WGSL engine {#_6-3-2-不确定度-wgsl-引擎}

The uncertainty kernel (`src/core/uncertainty`) includes two WGSL acceleration paths, both reusing the compute surface in this section:

- `gpu-engine.ts`: Percentile Bootstrap resampling on WebGPU. A fixed family of statistics (mean / median / variance / standard deviation / correlation / OLS slope) uses GPU kernels; custom JS statistics always use CPU. Resampling proceeds in chunks no larger than `blockSize` (default 65,536), reporting progress and responding to `AbortSignal` between chunks. The random source is the WGSL version of PCG32 (`PCG32_WGSL` in `pcg.ts`), sharing the same seed-sequence definition with the CPU path.
- `gpu-mcmc.ts`: Multi-chain random-walk Metropolis–Hastings. The caller supplies a WGSL log-density body (fixed dimensions baked into the kernel); after compilation, each thread carries one chain, chain state remains in buffers across dispatches, and million-step runs do not block the device or interface. The CPU path uses independent-chain parallel batches driven by mulberry32.

Engine selection (`auto` / `gpu` / `cpu`) follows the device availability rules in §3.1 and writes the selection to the run record. When GPU is unavailable it automatically falls back to CPU; for the same seed, results of the two paths agree within numerical tolerance, and convergence diagnostics (split-R-hat, ESS) are equally available for both.

### 6.4 End-to-end numerical verification {#_6-4-端到端数值验证}

The GPU path is not decorative: the `verify-webgpu` end-to-end suite drives a real WebGPU path in headless Edge (the SwiftShader software adapter), validating in two stages. Stage A requests a real WebGPU device via `tests/e2e/webgpu.html`, drives the native core module interface (buffer creation, kernel compilation, dispatch, `mapAsync` readback) using real WGSL kernels from `src/core/wgsl.ts`, and compares GPU results with the CPU integrator for strict and boundary scenarios respectively (tolerances 5e-3 and 0.02). Stage B loads the particles plugin and galaxy sample in the workbench, clicks “GPU 计算,” and asserts that the success notice reports the actual engine and measured GPU time. Unit tests cover each WGSL template's generation, parameter packing, output size and CPU fallback consistency, as well as numerical comparisons between GPU and CPU paths at both kernel and domain levels.

### 6.5 Build and fallback {#_6-5-构建与降级说明}

The build command chain is: `npm run build` runs `build:wasm` (local Rust toolchain compiles into `src/native`) → `tsc --noEmit` → Vite production build → docs build. For frontend-only builds, use `npm run build:web`, which starts with `make-wasm-stub.mjs`: when real build artifacts are absent, this script creates a functional placeholder module (`core_version` returns `'wasm-stub'`, `detect_file_kind` falls back to extension detection, and no GPU bindings are included), ensuring the dynamically imported chunk exists at bundle time. CI environments do not install the Rust toolchain (except the deploy workflow), so **release builds run the placeholder module**.

Runtime fallback is handled by the loader in `src/core/wasm.ts`: if dynamic import fails, it retries 3 times (1 second apart) and eventually marks the module unavailable. Summary of the three paths:

| Tier | Condition | Compute path |
| --- | --- | --- |
| Local full build (optional) | Run `build:wasm` locally to compile the real module | WASM bindings path |
| Actual release build path | Build contains only the placeholder module and WebGPU is available | Browser-native WebGPU |
| Fallback path | WebGPU unavailable | CPU implementation mathematically consistent with the kernels |

At every tier, the welcome page's hardware self-check reports WebGPU, WASM, and IndexedDB availability accurately; plugins perform the same mathematics on CPU without a GPU, with consistent behavior.

#### 6.5.1 3D scene host and missing WebGL {#_6-5-1-3d-场景宿主与-webgl-缺席}

3D rendering is managed centrally by the host: `createScene3D(container)` in `src/core/scene3d.ts` lazily creates a Three.js scene container and caches it per session. The host owns the rendering loop, OrbitControls, zoom, and GPU resource cleanup; plugins implement `renderToScene(scene)` (`Scene3DHandle`) to attach their meshes and lights to the scene. Only plugins declaring `renderToScene` materialize a WebGL scene on activation, so 2D plugins do not pay the WebGL context cost. When WebGL is unavailable or the 3D container is absent, affected plugins display an explicit 2D notice and continue using a 2D canvas. The AI training plugin's TF.js backend likewise falls back to CPU without WebGL—functional degradation is always explicit and observable.

## Chapter 7. Scientific computing subsystems {#第七章-科学计算子系统}

### 7.1 Kernel overview {#_7-1-内核总览}

#### 7.1.1 Subsystem directories (43, grouped by domain) {#_7-1-1-子系统目录-43-个-按领域分组}

| Domain | Subsystem | One-line facts |
| --- | --- | --- |
| Statistics, inference and units | stats | Descriptive statistics, hypothesis tests, effect sizes, multiple-comparison correction, power analysis and bilingual result narratives (8 module files) |
| Statistics, inference and units | model | OLS / logistic / ridge / polynomial regression and residual diagnostics (Householder QR, IRLS, K-fold cross-validation) |
| Statistics, inference and units | inference | HMC / NUTS Bayesian sampling, model catalog, WAIC / PSIS-LOO comparison, posterior diagnostics and ONNX inference |
| Statistics, inference and units | uncertainty | Bootstrap / Monte Carlo / MCMC and WGSL GPU engines (gpu-engine, gpu-mcmc), PCG32, R-hat / ESS diagnostics |
| Statistics, inference and units | signal | Radix-2 FFT, windows, Savitzky-Golay filtering, ACF / PACF, additive time-series decomposition |
| Statistics, inference and units | units | Typed `Quantity`: SI prefixes, dimensional algebra and conversion checks |
| Data I/O and quality | io | Unified HDF5 / NetCDF / FITS / Parquet / Zarr loading (scientific.ts routes by magic number to RawVariable) |
| Data I/O and quality | chunked | Row-window reading of large delimited files (csv / tsv / dat / xyz / txt) |
| Data I/O and quality | data-quality | Column / table expectation contracts and lazy quality reports, schema suggestions from profiling, row quarantine |
| Data I/O and quality | cleaning | Five serializable cleaning-wizard step types with forward / backward / undo engine |
| Data I/O and quality | sanitize | Allowlist sanitizer for externally produced SVG (sanitizeSvg.ts) |
| Data I/O and quality | validation | Composable validators `(value, path) => issues[]`; schemas are ordinary data |
| Data I/O and quality | sql | DuckDB-WASM SQL workbench engine (lazy loading, timeouts and AbortSignal cancellation) |
| Plotting and delivery | plot | Pure-TS vector plotting: DataTable → publication-grade SVG, exportable as SVG / PDF |
| Plotting and delivery | figure | Multi-panel figures on journal-template grids (compose one SVG, export including PNG-600dpi) |
| Plotting and delivery | report | ReportSpec → one self-contained interactive HTML report (inline CSS / SVG / JSON) |
| Plotting and delivery | markdown | Markdown DOM enhancement: Mermaid diagrams and KaTeX formula rendering |
| Plotting and delivery | gallery | Built-in project gallery catalog and local “My Shares” storage (filter / share / store) |
| Plotting and delivery | submit | Pre-submission checklist and Chinese/English caption drafting |
| Plotting and delivery | package | Paper supplement ZIP packaging (manifest + data + code sessions, fflate compression) |
| Reproducibility and experiments | repro | Seeded random numbers, stable hashes, run manifests, DAG→Python export, repro.lock, environment snapshots |
| Reproducibility and experiments | experiment | Run-record model and A/B parameter comparison (IndexedDB `runs` store, not written into .clproj) |
| Reproducibility and experiments | lineage | File → run DAG lineage graph and Sugiyama-style layered layout |
| Reproducibility and experiments | sweep | Expand SweepPlan into deterministic design points (full grid / list / Latin hypercube) and run sweeps |
| Language runtimes and editor | pyodide | CPython runtime in a Web Worker (pyodide-worker, studio.py for injection, client runtime bridge) |
| Language runtimes and editor | r | R runtime factory: prefer full webR, fall back to built-in IR engine if missing and record the reason |
| Language runtimes and editor | monaco | Monaco editor host assembly (lazy-loaded) and `studio.*` completion data |
| Language runtimes and editor | notebook | Notebook cell / output models and safe small Markdown renderer |
| Domain compute kernels | chem | Element data, molecular structure and thermodynamics (bond energy / formation enthalpy, ΔG°(T), Arrhenius rates) |
| Domain compute kernels | geo | Spherical geometry and terrain meshes (spherical.ts, terrainMesh.ts) |
| Domain compute kernels | astro | Pure-TypeScript FITS (Flexible Image Transport System) reading and writing |
| Domain compute kernels | raytrace | GLSL ray-tracing shaders and shared astronomical calculations (sky-base, astro, glsl) |
| Domain compute kernels | ai | Offline intent engine (intents.ts rules synthesize `studio.*` code) and online-mode authorization policy (provider.ts) |
| Domain compute kernels | profiler | Single-pass streaming column profiling: Welford mean and variance, HLL cardinality, quality score and issues |
| Platform and infrastructure | git | Dual adapters for isomorphic-git + LightningFS and simple-git, automatic commits and reference-name normalization |
| Platform and infrastructure | vfs | Workspace file system (LightningFS / memory backends, paths, project skeleton) |
| Platform and infrastructure | research | ScienceOutputStrip unified scientific output bus (scienceOutput.ts, pure TS) |
| Platform and infrastructure | errors | AppError taxonomy, `Result<T, E>`, retries, assertion guards and global capture |
| Platform and infrastructure | course | Course-mode domain model, export and offline grading (IndexedDB `courses` store) |
| Platform and infrastructure | templates | Discipline template catalog, deterministic sample data and plugin scaffolding |
| Platform and infrastructure | theme-pack | `.cstheme` schema validation, registry, application and theme marketplace |
| Platform and infrastructure | plugin-tools | Built-in plugin panel enhancements (tables, localization) |
| Platform and infrastructure | bench | Import / compute / render / memory benchmark suites and structured results |

#### 7.1.2 Root-level modules (38) {#_7-1-2-根级模块-38-个}

| Group | Modules |
| --- | --- |
| Compute and rendering | gpu.ts (WebGPU device service), compute.ts (PluginApi.gpu compute surface), wgsl.ts (14 reusable WGSL kernels), gpu-kernels.ts (engine dispatch and size thresholds), wasm.ts (native module loader, retries 3 times), pointcloud-gpu.ts (million-point budget and downsampling), mesh3d.ts (3D mesh pipeline), scene3d.ts (host Three.js scene container), viewport2d.ts (2D viewport pan and zoom), perf.ts (FPS / frame time / GPU memory / JS heap monitoring) |
| Plugin runtime and security | sandbox.ts (plugin sandbox), plugin-worker.ts (plugin runtime in Worker), plugin-signing.ts (signatures and trust registry), crypto-primitives.ts (bundled signing primitives), cspkg.ts (third-party plugin packages), pluginCache.ts (plugin cache) |
| Data parsing and storage | fileFormat.ts (format detection), parse-tasks.ts (parse task definitions and shared runner), parse-worker.ts (parsing entry in Worker), worker-pool.ts (Worker pool), storage.ts (persistence), dataFiles.ts (data-file registration), opfs.ts (chunked OPFS storage), opfs-migration.ts (IndexedDB migration), exampleAssets.ts and examples.ts (built-in example assets and sample discovery), labHandoff.ts (one-time handoff between tools) |
| Workflows and application | boot.ts (startup gate), events.ts (typed publish/subscribe event bus), settings.ts (app settings), recentTools.ts (recent research tools), workspace-artifacts.ts (save experiment artifacts in project workspace), cpu-info.ts (CPU capability detection), logger.ts (session logging), download.ts (download helper), site-links.ts (navigation among three sites), pwa.ts (offline cache and Service Worker), citation.ts (citation and archival metadata) |

The following sections expand on core subsystems in statistics, I/O, plotting, reproducibility, modeling, inference and delivery.

### 7.2 Statistics kernel (src/core/stats) {#_7-2-统计内核-src-core-stats}

The statistics kernel consumes ordinary numeric arrays, DataTable or Dataset and returns structured results; all implementations are pure functions. Public exports by module:

| Module | Capability |
| --- | --- |
| descriptive | Mean, variance, standard deviation, median, quantiles, summary statistics, confidence interval for the mean (t-distribution critical value obtained with studentTInv) |
| special | Special functions: incomplete gamma and beta functions, cumulative normal and t distributions and their inverses (reused by tests and power calculations) |
| tests | One-sample, two-sample (Welch-corrected degrees of freedom) and paired t-tests, one-way ANOVA, Mann-Whitney U, chi-square independence test; structured results include statistic, p-value and degrees of freedom |
| effect | Cohen's d effect size, Pearson and Spearman correlations |
| correction | Bonferroni and Benjamini-Hochberg multiple-comparison corrections; p-values are cleaned first (non-finite values removed) |
| power | Power analysis for two-sample t-tests |
| narrative | Converts structured results from five major test families (t-tests, ANOVA, chi-square, correlation, linear regression) into publication-grade Chinese and English sentences; formats p-values by journal convention (`p < .001` as an inequality, others to three decimals without a leading zero), using neutral wording for nonsignificant results |

Boundary inputs explicitly throw errors rather than silently returning wrong numbers: division by zero in Welch degrees of freedom, too few ANOVA groups, and unequal paired-test lengths produce structured errors. Statistics reach users through 14 `stats.*` Flow blocks, calls such as `summary` in the Block and Code Studio API, and report-builder and Figure Studio caption drafts—all point to the same implementation.

### 7.3 Scientific binary I/O (src/core/io) {#_7-3-科研二进制-i-o-src-core-io}

Scientific data often uses domain binary formats. `scientific.ts` provides one entry: given a dropped or opened File, read its header and identify the format by magic number (or extension), route to the corresponding loader, and convert each variable, dataset or HDU into a unified `RawVariable` list. The caller converts these into project data files.

```mermaid
flowchart TD
    A["用户拖入文件"] --> B["读取文件头 512 字节"]
    B --> C{"按魔数或扩展名识别格式"}
    C -- HDF5 --> D["h5wasm 加载器"]
    C -- NetCDF --> E["netcdfjs 加载器"]
    C -- FITS --> F["fitsjs 加载器"]
    C -- Parquet --> G["parquet-wasm 加载器"]
    C -- Zarr --> H["zarrita 加载器<br/>（经 blob URL 访问分块）"]
    D --> I["统一为 RawVariable 列表"]
    E --> I
    F --> I
    G --> I
    H --> I
    I --> J["转为项目数据文件<br/>进入文件路由与插件"]
```

| Format | Typical domain | Library | Module |
| --- | --- | --- | --- |
| HDF5 | General scientific hierarchical data | h5wasm | hdf5.ts |
| NetCDF | Earth science, meteorology | netcdfjs | netcdf.ts |
| FITS | Astronomical images and tables | fitsjs | fits.ts |
| Parquet | Columnar tables | parquet-wasm (merges all record batches through apache-arrow) | parquet.ts |
| Zarr | Chunked N-dimensional arrays (local directory or remote store) | zarrita | zarr.ts |

Helpers (`types.ts`) include safe integer-to-Float64 conversion (int64 and uint64 datasets no longer throw), name sanitization, DataTable-to-CSV and dataset construction. Large-file imports first use `chunked/` row-window reading and content fingerprints, then parse in parallel in a Worker pool through `parse-worker.ts` and `worker-pool.ts`.

### 7.4 Publication-grade plot engine (src/core/plot) {#_7-4-出版级绘图引擎-src-core-plot}

Unlike plugin canvas rendering, the plot subsystem is a pure-TS vector engine intended to turn DataTable into publication-grade SVG and export it:

| Module | Capability |
| --- | --- |
| types | PlotSpec, PlotSeries, scale types and SVG payload definitions |
| scale | Linear, logarithmic and temporal scales, niceTicks tick values and tick formatting; explicit handling of degenerate domains (single point, zero span) |
| charts | Convert DataTable to line, scatter, histogram and bar charts |
| svg | renderSVG vector rendering, with attributes and text escaped separately |
| export | Export SVG and PDF (jsPDF + svg2pdf.js), download text |

Because the entire chain (data, scales, rendering, export) consists of pure functions, the engine has dedicated unit tests (`tests/plot`) and naturally complements the reproducibility kernel's DAG-to-Python export strategy. The four Flow `plot.*` blocks use this engine, complementing the four `viz.*` blocks that use plugin renderers.

### 7.5 Reproducibility kernel (src/core/repro) {#_7-5-可复现性内核-src-core-repro}

Reproducible scientific computation requires “the same inputs and parameters produce the same outputs.” The repro kernel provides six capabilities:

| Module | Capability |
| --- | --- |
| random | Seeded pseudorandom numbers: mulberry32 produces identical sequences from the same seed; global setSeed and currentSeed support session-level settings |
| manifest | `createManifest` records seed, Studio version, hash of each input file, block graph (hashed after topological sorting), and output; manifestToText generates archival text |
| exporter | DAG to Python: export a Flow graph as a standalone rerunnable Python script, using topoSort dependency ordering and including a seed setting consistent with the manifest |
| lock | `repro.lock` export and validation: data fingerprints, parameter hashes, seeds and code snapshots, five drift categories and one-click reruns |
| snapshot | Environment snapshot (version, platform and kernel availability) in the lockfile, helping determine “whether drift occurred in data or environment” |
| index | Unified exports and stable hashing (FNV-1a hashString, eight hexadecimal digits, reused for input and graph fingerprints) |

Run manifest contents:

```mermaid
flowchart LR
    A["随机种子"] --> M["运行清单<br/>（可归档、可校验）"]
    B["工作室版本号"] --> M
    C["输入文件内容哈希"] --> M
    D["区块图拓扑哈希"] --> M
    E["输出内容"] --> M
```

UI for manifests and rerun locks:

![Reproducibility lock — lockfile drift detection](../assets/screenshots/platform/laboratory/reproducibility-lock.png)

*The reproducibility lock archives a run manifest (seed, version, input hashes, block-graph topology hash, output, environment snapshot) as a verifiable `repro.lock`. The interface marks each work locked / drift detected / unlocked using five drift categories, allowing anyone to verify whether conclusions can be replayed unchanged.*

### 7.6 Uncertainty engine (src/core/uncertainty) {#_7-6-不确定度引擎-src-core-uncertainty}

| Module | Capability |
| --- | --- |
| bootstrap | Bootstrap confidence intervals: reproducible resampling, supporting statistics such as mean / median / standard deviation |
| montecarlo | Monte Carlo propagation: propagate input distributions through samples to an output distribution |
| mcmc | Metropolis-Hastings sampling (CPU path) |
| pcg | PCG32 pseudorandom number generator (TS implementation and WGSL `PCG32_WGSL`), sharing a sequence definition with GPU kernels |
| gpu-engine | WGSL GPU-accelerated percentile Bootstrap resampling (≤ 65,536 dispatches per block, with progress and cancellation) |
| gpu-mcmc | Multi-chain random-walk MCMC on GPU (one chain per thread, chain state resident in buffers) |
| diagnostics | Convergence diagnostics: R-hat, effective sample size ESS, HDI intervals and MCSE |
| index | Automatic CPU / GPU engine selection and unified exports; selection is written to the run record |

Engine selection follows the thresholds and device-availability rules in article 06. When GPU is unavailable it falls back to CPU; with the same random sequence the two paths agree within numerical tolerance, with dedicated consistency unit tests.

The uncertainty capability in the research-tool interface:

![Uncertainty — Bootstrap / Monte Carlo intervals](../assets/screenshots/platform/laboratory/uncertainty-bootstrap.png)

*The uncertainty lab compares Bootstrap confidence intervals and Monte Carlo propagation for the same statistic; resampling seeds are reproducible and the GPU path automatically takes over when sample size reaches the threshold.*

### 7.7 Unit system (src/core/units) {#_7-7-单位系统-src-core-units}

`quantity.ts` provides typed `Quantity` values: SI prefixes, dimensional algebra and conversion checks. It exposes them through the `units.convert` and `units.check` Flow blocks and the parameter panel's `QuantityInput` component, so physical parameters with units no longer appear as bare numbers in pipelines.

### 7.8 Signal processing (src/core/signal) {#_7-8-信号处理-src-core-signal}

| Module | Capability |
| --- | --- |
| fft | Radix-2 FFT and amplitude spectrum; mathematically consistent with GPU `fftKernelWGSL` |
| window | Window functions (Hann, Hamming, Blackman, etc.) |
| filter | Savitzky-Golay smoothing and moving-average filtering |
| correlation | Autocorrelation ACF and partial autocorrelation PACF |
| decompose | Classical additive time-series decomposition x = 趋势 + 季节 + 残差 (trend + seasonality + residual): trend uses a symmetric moving average (for an even period, a centered average of period plus one, as in X-11); seasonal components are phase-wise detrended means normalized to zero sum; residual summary provides mean / standard deviation and a Jarque-Bera-style skewness/kurtosis normality check |
| index | Unified exports; filtered columns can be saved as derived project files and enter the lineage graph |

Signal capabilities in the signal-lab interface:

![Signal lab — Welch PSD of an acceleration time series](../assets/screenshots/platform/laboratory/signallab-psd.png)

*The signal lab analyzes an acceleration time series: the main Welch PSD peak and harmonics are clear; it supports radix-2 FFT amplitude spectra, windows, Savitzky-Golay filtering and time-domain processing, with output sent to Figure Studio or saved back to project files.*

### 7.9 Modeling and inference {#_7-9-建模与推断}

**Regression modeling (src/core/model)**

| Module | Capability |
| --- | --- |
| linalg | Small dense linear algebra: transpose, multiplication, Householder QR and triangular solve (only what OLS / ridge / polynomial fitting require) |
| ols | Ordinary least squares (QR decomposition), with estimates, standard errors, p-values and confidence intervals in the coefficient table |
| logistic | Logistic regression (IRLS iteratively reweighted least squares) |
| ridge | Ridge regression, with K-fold cross-validation for parameter selection |
| poly | Polynomial fitting |
| diagnostics | 2×2 residual diagnostics (residuals–fitted, QQ, scale–location, residuals–leverage) |
| index | Unified fitting entry and result types |

**Bayesian inference · Inference Forge (src/core/inference)**

| Module | Capability |
| --- | --- |
| hmc | Hamiltonian Monte Carlo sampler with Dual Averaging step-size adaptation |
| nuts | No-U-Turn Sampler (U-turn criterion), without manually setting a step count |
| model / templates | Declarative likelihood templates (linear regression, logistic regression, etc.) with weak priors scaled to the data |
| model-catalog | Catalog of inferable models and parameter metadata |
| diag | Posterior diagnostics including R-hat, bulk / tail-ESS, HDI and MCSE |
| compare | WAIC and PSIS-LOO model comparison; PSIS uses raw truncation at 0.2 times the maximum weight (without full generalized Pareto refitting), and Pareto-k uses a Hill-type tail estimate, sufficient to flag k > 0.7 but not equivalent to full loo diagnostics |
| onnx-runner | In-browser ONNX model inference (WebGPU accelerated path) |
| types | Shared sampling, model and diagnostic types |

Inference capabilities enter pipelines as the three Flow blocks `stats.mcmc`, `stats.bootstrap`, and `stats.montecarlo`, and appear as full research-tool pages Inference Forge (`/studio/inference`) and model inference (`/studio/model-inference`).

Modeling and inference in the research-tool interface:

![Inference Forge — in-browser Bayesian MCMC (NUTS)](../assets/screenshots/platform/laboratory/inferenceforge-posterior.png)

*Inference Forge runs NUTS sampling in the browser (WebAssembly): posterior summaries with 94% HDI / MCSE / R-hat / ESS, WAIC / PSIS-LOO model comparison, posterior predictive checks, and trace + density plots, backed by the model / inference kernels in this section.*

### 7.10 Data engineering and reliability kernels {#_7-10-数据工程与可靠性内核}

| Subsystem | Key capabilities |
| --- | --- |
| data-quality | Pandera-style column / table expectation contracts and lazy quality reports; type inference and profiling (quartiles, IQR outliers, missing and deduplication counts), schema suggestions from profiles, row-by-row quarantine with rejection reasons, DataTable adapter |
| cleaning | Cleaning wizard step model and engine: five serializable steps—type conversion, missing-value policy (delete / mean / median / zero / forward fill), outlier marking (IQR / z-score), deduplication, column renaming. Steps never rewrite input tables and support forward / backward / jump and “undo this step.” |
| profiler | Single-pass streaming column profiles: numeric columns use Welford exact mean and variance plus reservoir sampling for quantiles and MAD; modified z-score (\|0.6745(x−median)/MAD\| > 3.5) counts outliers. Text columns use HyperLogLog for cardinality and Space-Saving for Top-K. Table-level Pearson / Spearman joint sampling and duplicate-rate estimates combine into a deterministic 0–100 quality score and issue list cached by content fingerprint. |
| chunked | Row-window reading of large delimited files (csv / tsv / dat / xyz / txt), keeping one chunk rather than the whole file in the working set; other formats still use whole-file I/O |
| sql | DuckDB-WASM engine lazy-loaded on first use; project files registered in DuckDB's virtual file system and exposed as tables; queries support timeout and AbortSignal, terminating the Worker and discarding the singleton on abort/timeout, then rebuilding on the next call |
| sanitize | Externally produced SVG is allowlist-sanitized (sanitizeSvg.ts) before rendering, removing scripts and event attributes |
| validation | Composable validators `(value, path) => issues[]`: composition is ordinary function composition and schema is ordinary data; reusable, partially applicable and testable without React. Type validators skip null / undefined; combine with `required()` when required. |
| errors | Structured error taxonomy and cause chains, `Result<T, E>` explicit error-value channel, retries with backoff and jitter plus cancellation, assertion guards, deduplicated error registry and bounded diagnostic ring, and global `error` / `unhandledrejection` capture |

`Result` exists because boundary code should not throw by default: an invalid CSV row or missing file is an **expected** result callers must branch on. Representing it as a value makes branches exhaustive under `noImplicitReturns` and removes stack overhead from hot validation paths.

Data profiling and cleaning in the research-tool interface:

![Data profiler — column-level quality score and issue list](../assets/screenshots/platform/laboratory/data-profiler.png)

*The data profiler provides Welford mean and variance, quantiles, outlier counts and HyperLogLog cardinality estimates per column, combining them into a deterministic 0–100 quality score and issue list cached by content fingerprint.*

![Data cleaning — reversible step wizard](../assets/screenshots/platform/laboratory/data-cleaning.png)

*The cleaning wizard is driven by this section's cleaning kernel: type conversion, missing-value policy, IQR / z outlier marking, deduplication and column renaming can all advance / go back / be undone, and never rewrite the input table.*

### 7.11 Research workflows and delivery {#_7-11-科研工作流与交付}

| Subsystem | Key capabilities |
| --- | --- |
| experiment | Run-record model and A/B parameter comparison: a durable snapshot of each execution (Flow / Block / Code / notebook / sweeps / uncertainty / modeling / inference), stored in IndexedDB `runs` and **not** written to `.clproj` to keep project files small; indexed by projectId and cleaned up with project deletion; content hashes reuse repro's FNV-1a |
| lineage | Data-lineage graph and layered layout: connect project files (sources) to runs (transformations) by file id in run records, using a Sugiyama-style layered DAG (longest-path layers, single-pass barycenter ordering, centered rows), without React / store / DOM dependencies |
| sweep | Parameter-sweep domain layer: `expandPlan` expands a SweepPlan into deterministic design points—full grid / list axes use a full Cartesian product, Latin hypercube axes use per-dimension stratified sampling, mixed lhs / grid plans are rejected (sample count has no unambiguous definition); pure TS, with all validation testable |
| figure | Publication-grade multi-panel figures: FigureSpec is a multi-panel PlotSpec container on journal-template grids (IEEE / Elsevier column widths, colorblind-friendly palette); `composeFigure` renders one standalone SVG (nested panel viewports and a/b/c labels), `exportFigure` handles SVG / PDF / PNG-600dpi downloads; composition only resizes and does **not** modify the original PlotSpec |
| submit | Pre-submission gate: `runSubmissionCheck` traverses a figure document (template, panels, captions, export settings) using the target journal profile (IEEE / Elsevier), returning passes and failures grouped by image / annotation / text / metadata. Each failure has an i18n message, fix key and DOM id of the problematic control so the UI can offer “locate issue”; `caption.ts` drafts bilingual “Figure 1. …” captions from chart type, column names and optional statistics |
| report | Interactive report builder: `buildReport` builds a ReportSpec (ordered sections: heading, Markdown, Figure Studio figure, table, run summary, filter) into **one self-contained HTML file**—inline CSS, SVG and JSON data plus a zero-dependency native-JS controller (linked filters, sortable tables); user strings are escaped first and embedded JSON uses `<script type="application/json">` with `<` Unicode-escaped to prevent `</script>` payload escape |
| package | Supplement packaging: manifest.json (project metadata, run records, lineage graph, author and license forms) plus optional raw data and code sessions, zipped with fflate for upload with a paper |
| notebook | Notebook model: flat list of Markdown / code cells persisted in `project.state.notebook`; execution semantics are in notebookStore (the Pyodide runtime is stateful and page-scoped); the module itself holds only cell model, output model and a safe small Markdown renderer |
| course | Course-mode domain model: local-first teaching loop—teacher creates a course (identified by local identity string, no accounts), publishes assignments bound to discipline templates; students claim tasks, work in projects and submit repro.lock snapshots; teacher views a student × assignment matrix, records grades and comments, and exports the class with one directory per student; persisted in IndexedDB `courses` |
| gallery | Project gallery: curated built-in catalog (catalog.ts) and local “My Shares” storage (localStorage), storing metadata and sanitized snapshot HTML for shared work so details can reopen offline; v1 uploads nothing, and delisting only marks an item (retaining audit trail) and filters it from all lists |
| templates | Discipline template catalog: early feature-demonstration samples rewritten as discipline scenarios, each starting with a real research question and including deterministic data and a 3–6-step guide; template content is embedded as `{ zh, en }` pairs (not in the global i18n dictionary), with only surrounding UI using `tpl.` keys |

Delivery and collaboration interfaces:

![Report builder — one self-contained HTML file](../assets/screenshots/platform/laboratory/report-builder.png)

*The report builder compiles ordered sections (heading, Markdown, Figure Studio figure, table, run summary, filter) into one self-contained HTML file—inline CSS / SVG / JSON and a zero-dependency native-JS controller, with linked filters and sortable tables.*

![Figure Studio — publication-grade figures and submission checks](../assets/screenshots/platform/laboratory/figurestudio-em.png)

*Figure Studio combines multi-panel figures on journal-template grids (IEEE / Elsevier column widths, colorblind-friendly palette), with caption drafting and a pre-submission gate (submit kernel).*

![Parameter sweeps — full grid / Latin hypercube design points](../assets/screenshots/platform/laboratory/parameter-sweeps.png)

*Parameter sweeps expand a SweepPlan into deterministic design points: full-grid / list axes use a Cartesian product, Latin hypercube axes use stratified sampling, and mixed plans are rejected to keep sample count unambiguous.*

![Course mode — local-first teaching loop](../assets/screenshots/platform/laboratory/course-mode.png)

*Course mode implements a teacher–student loop: the teacher publishes template-bound assignments, students submit run results (repro.lock snapshots), and the teacher grades a student × assignment matrix and exports the class as a package.*

### 7.12 Language runtimes and AI assistant {#_7-12-语言运行时与-ai-助手}

| Subsystem | Key capabilities |
| --- | --- |
| pyodide | Python runtime for Code mode: `pyodide-worker.ts` starts CPython in a Web Worker, `studio.py.ts` injects an importable module into `sys.modules`, and `runtime.ts` connects PyodideClient to the editor store and render bridge—streaming stdout/stderr, sending plot payloads through the same RenderedView → plugin path as Block mode, and converting Python variable snapshots into DataValue for the panel |
| r | R runtime factory `createRRuntime({ preferFull })`: prefer full webR; if the bundle is absent or startup fails, fall back to the built-in IR engine and record `fallbackReason` for accurate UI reporting. With `preferFull = false` use the built-in engine directly. The built-in path has no external dependencies and must always be available—the current release runs the full `studio.*` DSL by this path |
| monaco | Lazy Monaco host and language-service assembly, with `studio.*` completion data |
| ai | Two-mode assistant policy: offline (default) uses the pure-TS `intents.ts` rules engine to synthesize runnable `studio.*` Python code from natural-language requests (e.g. “correlate x and y and draw a scatter plot”) through five intent templates (correlation / regression / distribution / test / filter), without network access. Online mode requires **both** explicit authorization and a configured endpoint; if either is absent it refuses or degrades, preventing accidental prompt leakage. `validateStudioApi` ensures generated calls stay within the actual runtime module's API allowlist; the assistant never invents interfaces |
| theme-pack | `.cstheme` theme package: purely declarative data (CSS custom-property overrides, font preferences, density mode and optional chart palette), **never executable content**; `parseCsTheme` is the sole validation gate—strictly rejecting unknown keys at every layer and dangerous prototype keys such as `__proto__` / `constructor` / `prototype`, and requiring CSS variable names in `--kebab-case` |

### 7.13 Supporting infrastructure {#_7-13-支撑设施}

- **Run-log export**: `logger.ts` aggregates session logs and, with `download.ts`, supports exporting a log file from the workbench for issue reporting and regression diagnosis.
- **Plugin cache and sample assets**: `pluginCache.ts`, `exampleAssets.ts`, and `examples.ts` support discovery and loading of built-in sample data and projects (138 sample files in `examples/data`, 11 .clproj projects in `examples/projects`, 9 Python examples in `examples/code`).
- **viewport2d and dataFiles**: the 2D viewport abstraction (snapshot access, safe on plugin unload) and project data-file registration (`setProjectFiles` and `resolveDataFile`) let project-owned files, built-in examples and Code-mode `_FILES` share loading logic.
- **Tool handoff and artifact persistence**: `labHandoff.ts` supports one-time data handoffs between tools; `workspace-artifacts.ts` saves experiment artifacts in the project workspace; `recentTools.ts` records recently used research tools.
- **OPFS and migration**: `opfs.ts` provides chunked storage for large files; `opfs-migration.ts` smoothly migrates existing IndexedDB data while project metadata stays in IndexedDB.
- **Events and startup**: `events.ts` supplies a typed publish/subscribe bus for plugin↔plugin and plugin↔host communication; `boot.ts` gates startup, `settings.ts` manages app settings, and `cpu-info.ts` detects CPU capabilities for benchmarks and profiling.
- **PWA and cross-site navigation**: `pwa.ts` handles offline caching and the Service Worker precache manifest (generated by `gen-sw-precache.mjs`); `site-links.ts` connects the workbench, official website and documentation site.
- **Citation and archival**: `citation.ts` generates software citation and archival metadata; `gen-citation-cff.mjs` and `check-citation.mjs` maintain CITATION.cff.
- **Performance benchmarks**: `runAllBenchmarks()` in `bench/` runs import / compute / render / memory key-path suites and returns structured results with environment information (Node version, platform, architecture, CPU model, date). `scripts/bench-run.mjs` runs them headlessly in Node, writes `bench-results.json`, and compares with `bench/baseline.json` (see article 08).

These 43 subsystems and 38 root-level modules together form the product's scientific foundation: statistics, modeling and inference ensure professional results; I/O and data engineering provide open and trustworthy inputs; plots and multi-panel figures ensure publication-quality output; and reproducibility and delivery pipelines allow others to replay conclusions unchanged and receive them with a paper.

## Chapter 8. Testing and quality assurance {#第八章-测试与质量保障}

### 8.1 Unit tests (Vitest) {#_8-1-单元测试-vitest}

Run `npm test` (i.e. `vitest run`) for all unit tests. `npm run verify` runs type checking followed by unit tests and is the combined check the contribution guide requires to remain green.

Test files are organized by topic under `tests/`, half in the root and half in subdirectories:

| Topic | File count | Coverage |
| --- | --- | --- |
| Plugin runtime and plugin families (root) | 85 | Built-in plugins; research / geophysics / environmental / biology / data plugins; structure and chemistry plugins; electromagnetic eigenvalues and fluid coupling; 3D visualization; plugin enhancements and defect regressions; sandbox and cspkg; file-format routing; Git adapter; GPU services and WASM; theme packs; i18n; accessibility and contrast; citation metadata; PWA, gallery, courses, cleaning, submission, storage and run records, app state stores. Also kernel unit tests for 32 plugins in the research-grade suite (chemistry: titration / reaction order / Turing patterns; physics: quantum solver / Ising / heat engine / diffusion / diffraction / trajectories; engineering: circuits / trusses / control; biology and environment: pharmacokinetics / Mendelian genetics / neurons / predator–prey; earth science: carbon dating / soil water / hydrology; math: Fourier / domain coloring / ODE fields; statistics: CLT / Markov / Zipf; economics and psychology: options / evolutionary games / signal detection theory / reaction time; astronomy and data: transit / Hertzsprung–Russell diagram / image processing). |
| Editor and IR (editor/) | 15 | Shared IR validation and round trips, Blockly JSON ↔ IR, interpreter, JS and Python code generation, three-mode sync-threeway, block i18n, editor store, Studio API, code samples, and free three-language round trips pinned by `roundtrip-all-langs.test.ts` |
| Block system (blocks/) | 11 | DataTable operations, block catalog, compiler, executor, geometry, statistics blocks, file data, operators, visualization bridge, units |
| Statistics kernel (stats/) | 7 | Descriptive statistics, hypothesis tests, multiple-comparison correction, effect sizes, power analysis, special functions, narrative rendering of results |
| Platform core (core/) | 9 | Compute service and WGSL kernels, OPFS and migration, error taxonomy, validation framework, VFS paths, Worker pool |
| Stores (stores/) | 6 | project / notebook / experiment / chunk / block / aiPanel |
| I/O (io/) | 4 | HDF5 / NetCDF / FITS / Zarr loaders and helpers |
| R runtime (r/) | 4 | Runtime factory, full-runtime fallback, DSL, webR bridge |
| Reproducibility (repro/) | 4 | Random numbers, run manifests, lockfiles (including v2), snapshots |
| Uncertainty (uncertainty/) | 3 | Bootstrap, Monte Carlo, MCMC and diagnostics |
| Templates (templates/) | 3 | Discipline template catalog, plugin scaffolding, guided flows |
| Plugin signing / inference / sweeps / figures | 2 each | Signature verification and website packages, Bayesian templates and ONNX, design-point expansion, persistence and multi-panel figures |
| Other single-file modules | 1 each | AI assistant intents, chunked reading, data quality, lineage, models, notebook, packaging, pages, plots, profiling, reports, signals, SQL, units |

Notable testing techniques:

| Technique | Description |
| --- | --- |
| Reset module-level caches | Modules with module-level state, such as the WASM loader, are reset before each case with `resetModules` and `doMock`, then dynamically imported as fresh instances to prevent cross-test contamination. |
| FakeWorker drives the real runtime | Plugin Worker RPC uses a fake Worker to host the real runtime implementation and complete an end-to-end round trip in Node, without a browser. |
| Strict-mode pitfalls documented | `new Function` in strict mode cannot combine a `"use strict"` directive with default parameter values; the legacy sandbox therefore uses plain parameters and passes `undefined` explicitly. Such points that “look like style issues but are actually correctness issues” are recorded in test comments. |
| Institutionalized regression cases | Fixed plugin defects become regression cases such as `pluginBugfixes`, and tests verify i18n keys are complete to avoid recurrence. |

### 8.2 End-to-end tests (Playwright-core) {#_8-2-端到端测试-playwright-core}

Each script starts its own `vite preview` production preview (with exceptions for a few suites), drives a headless browser, and asserts real pixels and zero console errors:

| Suite | Port | Coverage |
| --- | --- | --- |
| smoke-test | 4173 | Startup, autoloaded plugins, automatic project creation, reactive parameters, recent project restoration |
| verify-ui | 4173 | Post-redesign functional regression and layout geometry: dimensions, theme switching, canvas visibility, plugin list |
| verify-fixes | 4177 | Auto-fit, unified monospace font, Run control switch, top-bar grouping |
| verify-3d | 4199 | 3D point cloud in the host Three.js scene |
| verify-plugins | 4198 | Mutual exclusion of 3D and 2D viewport visibility, contour rendering of a vortex field, scatter and tornado examples |
| verify-webgpu | 4289 (dev server) | Two stages: `tests/e2e/webgpu.html` requests a real WebGPU device in headless Edge (SwiftShader software adapter), drives the native-core module interface (buffers, kernel compilation, dispatch, mapAsync readback) with real WGSL kernels from `src/core/wgsl.ts`, and compares GPU and CPU integrators for strict and boundary scenarios (tolerances 5e-3 and 0.02). It then loads the particles plugin and galaxy sample in the app, clicks “GPU 计算,” and asserts that the success notice reports the real engine and measured GPU time. |
| verify-block-mode | 4174 | Block mode: mode switching, compilation, execution, block-to-code synchronization |
| verify-code-mode | 4175 | Monaco plus Pyodide: run Python, variable panel, console, plot canvas |
| verify-lang-modes | 4176 | R / JS Code mode and cross-mode switching, R→JS translation, lossless Flow ⇄ Block ⇄ Code cycle |
| verify-ai-samples | 4211 | Load all four AI training samples individually through the sample dialog and capture notices, making parsing failures observable rather than inferred |
| verify-ai-training | 4199 | AI trainer: hyperparameter panel, sample loading, real TF.js training and live loss curve, model-switch reset to default hyperparameters, logistic regression decision boundary, MNIST CNN digit thumbnails |
| verify-research | 4173 | Research-tool flow: launcher → run records → lineage → figure workbench → supplement packaging → notebook |
| verify-r-runtime | Custom | Full webR runtime check: after entering Code mode and switching to R, the engine badge must change to the full-R label and a real R program must print to the console; on fallback, capture the original import error for the fallback notice |
| verify-site | — | Merged deployment artifact integrity: a local static server probes each path; all 8 canonical paths return 200 and nonempty content |

**Runner.** `npm run test:e2e` is `node scripts/e2e-run.mjs` and chains **11 suites**: `smoke-test`, `verify-ui`, `verify-fixes`, `verify-3d`, `verify-plugins`, `verify-webgpu`, `verify-block-mode`, `verify-code-mode`, `verify-ai-samples`, `verify-ai-training`, and `verify-research`. The runner has `--continue` semantics: if a suite fails it continues through the others, prints a pass / fail summary, and exits nonzero if any failed, replacing the old npm chain's stop-on-first-failure behavior. It also supports filtering by name (`node scripts/e2e-run.mjs smoke ui`) and `--parallel <n>` concurrency (the harness automatically yields to another port on conflicts).

**Inside and outside the chain.** The three scripts not in the chain have separate entry points: `verify-lang-modes` depends on fully loading Monaco and Pyodide (slower); `verify-r-runtime` requires vendored webR artifacts; `npm run verify:site` checks merged deployment artifacts rather than a development preview (with `--merge`, it first runs `merge-deploy.mjs`, then serves `pages-out` locally and asserts that all 8 canonical paths—including the site root, favicon, `/app/` workbench, `/app/docs/` documentation site, and its deep pages—return 200 and nonempty content).

**Shared harness.** All suites use `scripts/_harness.mjs`, unifying three things formerly scattered in scripts and valid on only one machine as “resolve from the environment with reasonable defaults”: browser executable path (platform-specific candidates, Edge preferred and Chrome as fallback, with CI able to pin `CHROME_PATH`), screenshot directory (system temporary directory), and preview port (automatically select another if occupied). The harness also guarantees cleanup so failed assertions do not leak preview servers or browser processes.

The contribution guide requires new plugins or features to include an end-to-end check.

### 8.3 Performance benchmarks and size budgets {#_8-3-性能基准与体积预算}

Performance regressions use **baseline comparisons** rather than absolute thresholds, with separate baseline files per environment:

- `runAllBenchmarks()` in `src/core/bench/` runs four key-path suites—import / GPU kernels / rendering frame rate / memory—and returns structured results with environment information (Node version, platform, architecture, CPU model, date).
- `npm run bench` (`node --expose-gc scripts/bench-run.mjs && node scripts/bench-compare.mjs && node scripts/bench-report.mjs`) runs headlessly in Node and writes `bench-results.json`. `scripts/bench-compare.mjs` compares each metric to a baseline: `bench/baseline.json` targets developer machines, while `bench/baseline.<platform>-<arch>.json` (the repository already has `baseline.linux-x64.json` and `baseline.win32-x64.json`) targets CI because numbers on shared runners are not comparable to developer desktops. `scripts/bench-report.mjs` generates a single-file HTML report. CI uses `bench:ci` (both comparison and reporting include `--env-baseline`).
- On the first run in a new environment with no baseline, `bench-compare.mjs` records one and exits 0; the bench workflow commits that file back to the repository for future runs to enforce a real gate. Two **hardware-noise guards** re-record rather than falsely fail (the re-recorded file is **deliberately not committed** to avoid a commit on every run): ① the CPU model or Node version reported by the runner differs from the baseline; ② CPU/Node strings match, but ≥75% of throughput metrics regress in the same direction and all memory metrics remain level—a typical signature of the same CPU model moved to a different host (different microcode/firmware/load). Selective or mixed-direction real code regressions do not trigger the guard and still fail normally.
- For size, `scripts/build-budget.mjs` analyzes build artifacts (`dist/`, or `pages-out/app/` after merged deployment) and gates against the root `budget-baseline.json` (FR-06).

### 8.4 Continuous integration (5 workflows) {#_8-4-持续集成-5-条工作流}

| Workflow | Trigger | Key steps and gates |
| --- | --- | --- |
| **ci** | Push to main, all PRs | Two jobs. `verify`: citation metadata check (FR-10) → `tsc --noEmit` → ESLint → `npm test` → generate WASM stub → `build:web` → performance budget (FR-06). `e2e-smoke`: after building, run the two fastest end-to-end suites with `e2e-run smoke ui` (runner-provided Chrome pinned through `CHROME_PATH`); the full suite remains local. Any failure makes CI red. |
| **bench** | Push to main, Release publication | `npm run bench:ci` (run benchmarks + compare against environment baseline) → commit the environment baseline on first run (job has `contents: write`) → write results to job summary and upload an artifact; attach to the Release on publication (FR-23). |
| **security** | Push to main, PR, every Monday 03:00 UTC, manual | Three parallel jobs: OSSF Scorecards (v2.4.4, SARIF retained 30 days), SBOM generation (CycloneDX 1.5, generated from `package-lock.json` by a dependency-free Node script, retained 90 days), `npm audit` (**high / critical block merging**, with an `AUDIT_ALLOWLIST` exception mechanism requiring a reason and follow-up issue; exceptions become warnings). |
| **release** | Push `v*` tag | build: generate WASM stub → `build:web` → generate `CITATION.cff` → package dist zip; archive: deposit with Zenodo and mint a DOI, **explicitly erroring with three configuration steps if `ZENODO_TOKEN` is missing** rather than silently skipping archival; release: publish a GitHub Release with zip, `CITATION.cff`, and DOI. |
| **deploy** | Push to main, manual | Install Rust (`wasm32-unknown-unknown` target, cached) and `wasm-bindgen-cli 0.2.127` → `build:wasm` compiles real WASM → build workbench `app/` and official root site → `deploy:merge` combines artifacts → `verify-site` checks 8 canonical paths → publish GitHub Pages. |

**CI has no Rust toolchain** (except deploy): other workflows' `dist` uses a module stub generated by `scripts/make-wasm-stub.mjs`, because `vite build` splits the dynamic import in `src/core/wasm.ts` into a separate chunk; only the chunk's existence is needed at build time, not the real kernel.

**The build chain has built-in gates**: `npm run build` = `build:wasm` && `tsc --noEmit` && `vite build` && `build-docs`, stopping if any step fails. For frontend-only scenarios use `npm run build:web` (skips WASM compilation and starts with a stub).

### 8.5 Engineering scripts {#_8-5-工程脚本}

The 41 engineering scripts under `scripts/` (40 `.mjs` + 1 `.py`, plus shared type declarations and benchmark run logs) fall into seven categories:

| Category | Scripts |
| --- | --- |
| End-to-end and harness | `e2e-run.mjs` (runner: --continue, summary table, --parallel), `_harness.mjs` (shared harness), `smoke-test.mjs`, `verify-*.mjs` (13: webgpu / 3d / plugins / code-mode / block-mode / lang-modes / r-runtime / ai-samples / ai-training / research / ui / fixes / site), `_line-check.mjs` (visually inspect actual rendering colors of the current Monaco line and selection) |
| Performance and budget | `bench-run.mjs`, `bench-compare.mjs`, `bench-report.mjs`, `build-budget.mjs` |
| Build and deployment | `build-wasm.mjs`, `make-wasm-stub.mjs`, `build-docs.mjs`, `merge-deploy.mjs`, `gen-sw-precache.mjs`, `copy-pyodide.mjs`, `copy-webr.mjs`, `vendor-blockly-media.mjs` |
| Assets and sample generation | `make-example-data.mjs` (rebuild distribution.dat, field.json, and base64 test patterns for image demos), `make-example-projects.mjs` (build example .clproj files from sample data), `gen-ai-examples.mjs` (seeded PRNG producing deterministic, committable CSV learners can inspect) |
| Compliance and signing | `sign-cspkg.mjs` (.cspkg signing CLI: --genkey generation, signing, verification), `gen-sbom.mjs` (CycloneDX SBOM), `gen-citation-cff.mjs`, `check-citation.mjs` |
| Domain-specific | `chem-reactmd-validate.mjs` (runs the Python NumPy engine for all catalog reactions with real payloads at low / high temperatures and prints a comparison table, confirming each reaction physically completes only at high temperature), `repro-plugins.mjs` (one-time reproduction and baseline checks for the two competition plugins fluid-cfd-coupler and em-eigensolver), `make-qr.py` (QR generation) |
| Technical documentation typesetting | `build-tech-docs.mjs` (md → paginated HTML → A4 PDF), `build-tech-summary.mjs` (assemble a compendium from individual chapters so the compendium cannot drift from them) |

`gen-citation-cff.mjs` and `check-citation.mjs` maintain `CITATION.cff` together, one writing and one checking (the checker compares hard-coded author / license values in `src/core/citation.ts` with `package.json`, exiting nonzero and failing CI on drift). `gen-sw-precache.mjs` generates the Service Worker precache manifest so offline coverage matches build artifacts exactly. `copy-pyodide.mjs` and `copy-webr.mjs` vendor Python / R runtimes for local self-hosting, avoiding runtime dependence on a public CDN.

**Technical documentation typesetting pipeline.** Eleven documents under `docs/technical/` are rebuilt by `node scripts/build-tech-docs.mjs`: Markdown is converted to blocks by a built-in subset parser, Mermaid fences are rendered to inline SVG in a headless browser at build time (the output has no client-side scripts, and the PDF contains scalable vector graphics), and then **each block's height is measured** at real page dimensions and packed by page height. A fixed-height `.page` with `overflow: hidden` would clip content whenever a section grows if content were balanced by eye, so pagination must be measurement-driven. Measurements also populate TOC page numbers, and every generated page is rechecked for content crossing the bottom margin; overflow causes repagination with reduced usable height. The technical summary (`Ergalics Studio.md`) is assembled from the eleven individual source articles by `build-tech-summary.mjs`, so “individual article updated while compendium retains old numbers” cannot occur.

### 8.6 Quality principles {#_8-6-质量原则}

1. **Pure functions first.** The compiler, statistics kernel, plot and figure engines, code generation, and IR conversion are pure functions and can be tested directly in Node. The lineage graph's layered layout also has no React / store / DOM dependency.
2. **Contain side effects.** The block system has only one side-effectful module, the render bridge; the executor is asynchronous but side-effect-free. The research-tool glue layer (`researchUi.ts`) is also deliberately thin and free of React dependencies so it can be tested separately.
3. **Numerical consistency as a safeguard.** Every GPU kernel has a mathematically consistent CPU implementation, checked for agreement at both unit and end-to-end levels—this is the prerequisite for trusting automatic fallback.
4. **Make boundaries explicit.** Boundary inputs produce structured errors, empty-data startup has guarded notices, and missing capabilities are honestly reported by self-checks, rather than silent failure or degradation; reproducibility has dedicated gate documentation.
5. **Never skip silently.** Archival must actually occur when required (missing Zenodo configuration errors with guidance), gates must actually be enforced (audit exceptions need reasons), and a missing first-run baseline is recorded and committed—distinguishing “did not run” from “ran.”

## Chapter 9. User guide {#第九章-使用指南}

### 9.1 Technology stack and environment requirements {#_9-1-技术栈与环境要求}

Ergalics Studio is a pure-frontend single-page application. Its only mandatory dependency is a modern browser; the only optional local toolchain is Rust (used only to compile the native core to WebAssembly; without it, the frontend degrades gracefully).

| Layer | Technology |
| --- | --- |
| Interface | React 18, react-router-dom 7, Zustand 5 |
| Language | TypeScript 5.7 (strict mode) |
| Build | Vite 6 + Vitest |
| Visualization | Native Canvas/WebGL, Three.js, WGSL compute shaders |
| Editors | Monaco Editor, Blockly 13 |
| Runtimes | Pyodide (CPython), DuckDB-WASM, TensorFlow.js |
| Scientific I/O | h5wasm, netcdfjs, fitsjs, zarrita, parquet-wasm (with apache-arrow) |
| Packaging and compression | fflate, lz-string |
| Native core | Rust (wasm32-unknown-unknown) + wasm-bindgen 0.2 |
| End-to-end tests | playwright-core driving headless Edge |
| License | MIT |

Browser-side requirements are WebGPU / WebAssembly / Web Worker / IndexedDB. WebGPU and WASM are optional: if absent, the app reports this accurately during the welcome-page self-check and falls back to CPU computation.

### 9.2 Install, run and build {#_9-2-安装、运行与构建}

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器
npm run build        # 完整构建：WASM 核心 → 类型检查 → 打包 → 文档站
npm run build:web    # 只构建前端（跳过 Rust 步骤）
npm run preview      # 预览生产构建
```

Quality checks:

```bash
npm test             # Vitest 单元测试
npm run verify       # 类型检查（tsc --noEmit）+ 单元测试
npm run test:e2e     # Playwright 端到端套件（需本机浏览器）
npm run bench        # 性能基准并对基线
```

`npm run build` includes gates: failure in WASM compilation, type checking, bundling or docs copying stops the chain. Type checking also serves as lint—the codebase does not introduce an additional lint ruleset, instead relying on TypeScript strict mode for constraints.

### 9.3 Supported data formats {#_9-3-数据格式支持}

| Category | Formats | Description |
| --- | --- | --- |
| Tables and text | CSV, TSV, DAT, TXT, MD | Delimited text and tabular data; project data files can be imported directly |
| XY spectral text | XY, XYE | Two-column (2θ–intensity, XYE includes an error column) x–y text data; `#` lines are comments; loaded directly by plugins such as XRD pattern analysis |
| Grid and point data | JSON, XYZ | Numeric grids, scalar fields and point clouds (JSON matrix / XYZ columns) |
| Matrices and arrays | MTX, NPY, NPZ | Matrix Market sparse matrices and NumPy arrays (e.g. electromagnetic resonance eigenvalue solving) |
| Chemical structures | CIF, POSCAR, VASP | Unit-cell structures: atoms, periodic bonds and density estimates |
| Geography and tracks | GeoJSON, GPX, ASC | Vector maps, GPS tracks, ESRI ASCII Grid elevations |
| Biological sequences and genetics | FASTA, FA, VCF | Sequence alignment and analysis, population genetic variants |
| Images | PNG, JPEG, WEBP, GIF | Image viewer loads bitmaps |
| Scientific binary | HDF5 (.h5/.hdf5/.hdf, MAT v7.3, h5ad), NetCDF (.nc), FITS (.fits/.fit), Zarr (.zarr), Parquet (.parquet) | Pure TypeScript dispatcher routes by magic number to loaders; decoded data enters the project as CSV |
| Project | .clproj | Project-specific format, lz-string compressed |
| Plugin package | .cspkg | fflate package, with manifest and optional signature validation on load |
| Theme package | .cstheme | Pure declarative data, never carrying executable content |

Large files first undergo chunked reading and content fingerprinting, then are parsed in parallel by a Worker pool.

### 9.4 Sample resources {#_9-4-示例资源一览}

| Location | Contents |
| --- | --- |
| examples/data | Loadable example datasets accompanying each built-in plugin |
| examples/projects | 11 real .clproj Flow pipelines (signal analysis, binning statistics, dual-pipeline comparison, etc.) |
| examples/code | 9 Python examples (EDA pipeline, Monte Carlo circle estimation, signal smoothing, etc.) |
| src/editor/block/samples.ts | 5 Block examples (galaxy scatter, telemetry line, random histogram, etc.) |
| src/core/templates | Discipline template catalog with deterministic datasets and 3–6-step guides |

### 9.5 Contributing {#_9-5-参与贡献}

The contribution process requires reading ARCHITECTURE.md and REQUIREMENTS.md at the repository root before changes; new plugins or features need an end-to-end check; keep `npm run verify` green before submitting. Fixed defects should become regression cases rather than only code changes.

### 9.6 License {#_9-6-许可证}

MIT. Software citation and archival metadata are maintained in `CITATION.cff` (generated from package.json by script and checked in CI); tagged releases are automatically archived to Zenodo and assigned a DOI.

## Chapter 10. Technical innovations {#第十章-技术创新}

### 10.1 Technical innovations {#_10-1-技术创新}

- **Four modes, shared IR.** Block, Flow, and Code modes convert bidirectionally through one intermediate representation, with dedicated round-trip unit tests; the `verify-lang-modes` end-to-end suite checks lossless Flow ⇄ Block ⇄ Code cycles. Code-mode buffer contents can be parsed back into IR, and Python / R / JavaScript can be freely translated back and forth. The same analysis logic can exist as blocks, a flowchart, or a script and switch forms at any time.
- **Full-stack runtime in the browser.** Python runs on a real CPython in a Pyodide Worker (`studio` is injected as an importable module); R runs on the vendored webR 0.6.0 runtime (falling back to the IR engine when assets are missing); persistence uses IndexedDB and OPFS. The Python / R runtimes are vendored and self-hosted locally, require no public CDN, and can be used offline.
- **Real GPU computation and graceful degradation.** Fourteen real WGSL compute kernels (including D2Q9 fluid, all-pairs N-Body, wave equation, FFT, K-means, and SpMV) run on the GPU when WebGPU is available. Each has a mathematically consistent CPU implementation, and unit tests check numerical consistency between the two paths. Data sizes below a threshold or a missing device trigger automatic CPU fallback; engine selection is written to the run record for traceability.
- **Two competition-grade solvers.** The electromagnetic resonance eigensolver targets indefinite sparse Hermitian matrices of order 100,000, providing thick-restart Lanczos, block LOBPCG, and Jacobi-Davidson kernels, with eigenpairs certified by true residuals. The 1D–3D bidirectional coupling solver uses multi-rate time-step coordination and coarse–fine time subcycling to drive transient simulation of a 1D pipe network and 3D field, with forward and reverse boundary coupling and conservation audits.
- **Sandbox + signature as independent defenses.** Third-party packages run in an isolated Web Worker sandbox by default and communicate with the host via typed RPC; canvas rendering uses transferred OffscreenCanvas. `.cspkg` loading validates the manifest (required fields, id format, entry-path traversal protection, etc.) and supports Ed25519 signatures and a trust registry (implemented in pure TypeScript without depending on WebCrypto). The sandbox constrains “what can be done”; signatures answer “who published it.” The two defenses are independent.

## Chapter 11. Application Scenario Library {#第十一章-应用场景库}

## Appendix. Document index {#附录-文档索引}

| Document | Contents |
| --- | --- |
| 01-产品介绍 | Reviewer overview: project, technical innovations, functional overview, scenarios, open-source governance and long-term development |
| 02-系统架构 | Layers, routing and pages, startup sequence, state management, rendering pipeline, directory structure and dependency rules |
| 03-插件系统 | Plugin contract, details of 107 built-ins (including 32 research-grade suite plugins), marketplace and two-level loading, cspkg sandbox and Ed25519 signing, file routing |
| 04-四大工作模式 | Standard, Flow, Block and Code designs and three-mode conversion via shared IR |
| 05-科研工具集 | Unified registry for 26 tools, six groups and individual responsibilities, navigation and inter-tool flow |
| 06-GPU计算与原生核心 | Native-core source delivery and runtime WebGPU/CPU fallback, WebGPU compute pipeline, 14 reusable WGSL kernels |
| 07-科学计算子系统 | Statistics, scientific binary I/O, publication plotting and multi-panel figures, reproducibility, uncertainty, modeling and inference across 43 subsystems |
| 08-测试与质量保障 | Unit and end-to-end tests, performance baselines and size budgets, five CI workflows and engineering scripts |
| Electromagnetic resonance eigensolver (standalone topic) | Sparse Hermitian eigenvalue solving: Lanczos / LOBPCG / Jacobi-Davidson, MINRES shift-invert, true-residual certification, 3D mode fields, Pyodide Worker runtime |
| Fluid bidirectional coupling solver (standalone topic) | 1D pipe-network–3D field bidirectional coupling: multi-rate time-step coordination, coarse–fine subcycling, forward/reverse boundary coupling, millisecond valve control, conservation and accuracy–efficiency tradeoffs |
| Fluid bidirectional coupling solver container deployment manual (standalone topic) | One-command Docker orchestration and CLI reproduction: reproduce 26 validation assertions and benchmarks in containers, production static mode and troubleshooting |
| Application Scenario Library (standalone topic) | 81 detailed scenarios from advanced research to basic teaching, each mapped to a real plugin or research tool with screenshots, cross-referenced to articles 03 / 05 |
| Ergalics Studio (this document) | Complete technical summary assembled from the chapters and standalone topics in this directory, with navigation, body and this index |
| docs/guide (VitePress site) | User-facing online documentation: introduction, architecture, modes, testing, roadmap, plugins and more |

This document evolves with the documents and repository code above: when code, configuration or tests change, check and update the corresponding figures and descriptions as well.
