# 测试

测试是代码库的一等组成部分，而非事后补充：**单元测试**在 Node 环境中覆盖核心逻辑，**端到端测试套件**则在无头浏览器中驱动生产预览。

## 单元测试（Vitest）

```bash
npm test           # vitest run
npm run test:watch
```

环境：`node`。263 个测试文件，4078 个测试（4076 通过、2 个跳过）：

| 测试套件 | 覆盖范围 |
| --- | --- |
| `fileFormat` | 魔数和扩展名检测、格式匹配 |
| `gitAdapter`, `opfs-helpers` | Git 适配器契约（浏览器/Node）、工作区 VFS 行为 |
| `cspkg` | zip 解析、清单校验、入口执行（trusted） |
| `sandbox` | RPC 编码/解码、旧版回退、通过模拟 Worker 完成的**完整 Worker 往返** |
| `i18n` | 语言切换、回退、新增沙箱键 |
| `appStore` | 横幅、通知、性能警告 |
| `wasm` | 使用模拟模块验证加载器重试策略（3 次、间隔 1 秒） |
| `gpuService` | 计算服务设备可用性控制 / CPU 回退 |
| `gpuCompute` | WGSL 模板生成、缓冲区打包、CPU 积分器、粒子回退 |
| `builtinPlugins` | 等高线网格归一化、散点解析 |
| `sciencePlugins` | 三维 N 体内核/打包/动量守恒及插件 CPU 回退；蛋白质力导向布局、连通分量、无数据保护 |
| `geoPhysicsPlugins` | 流体 WGSL 内核、`fluidStepCPU` 和掩码解析；波动内核/步进/数据解析；双摆物理和初始条件；GeoJSON 解析 |
| `dataPlugins` | 误差带行、树图层级、数值列、QQ probit |
| `wgsl` | 直方图 / 热力图 / 点云 GPU 内核：WGSL 输出、参数打包、输出大小、CPU 回退一致性 |
| `blocks/*` | 区块系统端到端——注册表、编译器（校验/拓扑/类型）、执行器（增量缓存和失效）、DataTable 操作、几何、统计、目录执行器、`viz.*` 渲染桥接 |
| `editor/*` | 共享 IR（校验/往返转换）、Blockly JSON ⇄ IR、解释器、JS/Python 代码生成、三模式 `sync-threeway`、积木国际化（`BKY_*`）、编辑器 store、Studio API、代码示例 |
| `stats/*`, `io/*`, `plot/*`, `repro/*` | 统计检验辅助函数、NetCDF I/O、绘图辅助函数、可复现性 |
| `pluginRuntime`, `pluginBugfixes` | 插件生命周期、市场门禁、已修复插件缺陷的回归测试 |
| `structure-sim` | 桁架求解器：杆件内力、利用率、过载坍塌 |

值得注意的技术：

| 技术 | 细节 |
| --- | --- |
| **模块级缓存** | （如 WASM 加载器）在每个测试中通过 `vi.resetModules()` + `vi.doMock` + 一次新的动态 `import` 重置。 |
| **Worker RPC** | 使用驱动真实 `createPluginWorkerRuntime` 的 `FakeWorker` 进行端到端测试——无需浏览器。 |
| **严格模式下的 `new Function`** | 不能将 `"use strict"` 指令与默认参数值组合使用——旧版沙箱使用普通参数并显式传入 `undefined`。 |

## 端到端测试套件（Playwright-core）

```bash
npm run test:e2e
```

每个套件在首选端口启动本地服务器（`vite preview`，或对 `verify-webgpu` 使用开发服务器；端口被占用时回退到任意空闲端口），驱动无头 Edge（默认路径为 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`），并断言真实像素及零控制台错误：

| 测试套件 | 端口 | 覆盖范围 |
| --- | --- | --- |
| `smoke-test` | 4173 | 启动、自动加载插件、响应式参数、项目恢复 |
| `verify-ui` | 4173 | 布局指标、主题、画布可见性 |
| `verify-fixes` | 4177 | 所有示例插件正确渲染其示例数据 |
| `verify-3d` | 4199 | 宿主 Three.js 场景中的 3D 点云 |
| `verify-plugins` | 4198 | 3D↔2D 表面可见性、等高线、散点、龙卷风示例 |
| `verify-webgpu` | 4289 | 无头 Edge（SwiftShader）中的真实 WebGPU 路径：数值测试程序（GPU 与 CPU 积分器误差约在 2e-6 以内）+ 验证出现 `wasm` 引擎提示的 Particles 应用集成测试 |
| `verify-block-mode` | 4174 | 积木编辑器：模式切换、编译、运行、积木 → 代码同步 |
| `verify-code-mode` | 4175 | Monaco + Pyodide：运行 Python 程序、控制台、变量面板、绘图画布 |
| `verify-ai-samples` | 4211 | AI Training：加载全部 4 个示例（线性 / 非线性 / 逻辑回归 / MNIST） |
| `verify-ai-training` | 4199 | AI Trainer：激活、TF.js 训练、损失曲线、模型切换重置、决策边界、MNIST CNN 网格 |
| `verify-research` | 4176 | 科研套件：运行记录 / 不确定度 / 性能分析器 / 图表 / 补充材料 / 笔记本 / 谱系 |

`verify-lang-modes`（IR 引擎上的 R/JS 和模式往返转换）、`verify-r-runtime`（webR 运行时完整性）和 `npm run verify:site`（合并部署路径完整性）单独运行。

> 如果 Edge 或 Chrome 不在默认路径，请将 `BROWSER_PATH`（或 `EDGE_PATH` / `CHROME_PATH`）指向可执行文件。新插件或功能应附带端到端检查——截图写入临时 `ergalics-shots` 目录（可通过 `SHOTS_DIR` 覆盖），供视觉检查使用。

## 组合检查

```bash
npm run verify       # typecheck + unit tests
npm run build        # wasm + typecheck + production build
```
