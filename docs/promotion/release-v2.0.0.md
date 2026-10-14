# Ergalics Studio v2.0.0 · 首个正式版

Ergalics Studio 是一个运行在浏览器里的开源科学计算工作站：无需安装任何软件，打开网页即可完成数据导入、可视化、统计检验、数值模拟与科研绘图。项目以「插件化的科研操作系统」为设计目标——沙箱化的插件体系、统一科研元数据、GPU 加速计算与可复现性内核，让从课堂演示到准研究级的分析都能在同一环境中完成。

经过一年迭代与 v0 → v1 → v2 三个阶段的架构演进，v2.0.0 是首个面向公众的正式版本。

## 核心特性

### 四模式工作台
- **标准模式**：拖入数据即出图，参数面板实时调节，零代码完成完整分析
- **流程模式**：以 38 个内置区块（数据源 / 变换 / 过滤 / 数学 / 统计 / 单位 / 可视化）可视化搭建数据流水线，拓扑执行、逐节点检查
- **代码模式**：Python（Pyodide 完整运行时）、R（webR 完整 R 运行时）、JavaScript 三语言，与画布插件双向联动（`studio.plot(...)` 直达绘图插件）
- **积木模式**：类 Scratch 的科研积木编辑器，适合编程入门教学
- 左侧活动栏（文件 / Git / 插件）+ 中央标签区 + 每文件类型编辑器；命令面板（Ctrl+K）与全局快捷键

### 107 个内置插件 · 16 个学科分组
- 覆盖图表 / 统计 / 数学 / 物理 / 化学 / 生物 / 地理 / 环境 / 天文 / 材料 / 工程 / 经济 / 心理 / 数据 / 特效渲染 / 趣味工具
- 二级加载机制：97 个科研插件自动加载 + 10 个按需加载，首屏不臃肿
- 全部插件接入统一科研元数据系统：就绪分级、物理量单位、可复现标记、结构化科研输出条（ScienceOutputStrip）
- 一键「发送到 Figure Studio」组装多面板出版级图组

### GPU 计算与真实物理模拟
- 14 个可复用 WGSL 计算内核（WebGPU），CPU 自动回退
- 广义相对论实时光线追踪黑洞（Binet 形式测地线 RK4 积分、ISCO 吸积盘、多普勒集束与引力红移）
- 波动方程 FDTD 水波求解器、Nishita 大气散射、基于 GMST 与 Bortle 分级的夜天渲染器
- 流体 CFD 双向耦合求解器（1D 管网 × 3D 场）

### 26 个独立科研工具
- 不确定度（Bootstrap CI / Monte Carlo 传播 / MCMC，含 R-hat 与 ESS 收敛诊断）
- 量纲安全单位制、分块大数据摄入（HDF5 等格式）
- 文件资源管理器、工作区 Git（自动提交）、可复现性内核（`repro.lock`）
- 以 ToolShell 形式嵌入工作台画布

### 工作区文件系统
- 浏览器内 VFS（LightningFS / IndexedDB），流程图与积木程序持久化为 `.flow.json` / `.block.json`
- 项目导出日志、数据簇徽标、最近项目管理
- 画布级统一导出：PNG 下载 / 存入工作区 `figures/`，3D 场景支持透明背景

### 工程质量
- TypeScript strict、沙箱化插件 RPC 协议、`.cspkg` 插件包签名门禁
- 123 个测试文件、2200+ 单元测试用例，Playwright E2E（headless Edge），`pre-push` 钩子自动跑测试
- `npm audit` 零发现（2026-10-13 安全升级窗口，详见 SECURITY.md）
- 社区文档完整双语：CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG / PR 与 Issue 模板

## 快速开始

**在线使用（推荐）**：打开即用，无需安装
https://snowleopard-io.github.io/ErgalicsStudio/app/

**本地构建**：

```bash
git clone https://gitee.com/cnt-code/ergalics-studio.git
cd ergalics-studio
npm install
npm run dev
```

要求：现代浏览器（推荐 Chrome / Edge 以获得 WebGPU 支持）。

## 链接

- 中文文档：https://snowleopard-io.github.io/ErgalicsStudio/
- GitHub：https://github.com/SnowLeopard-io/ErgalicsStudio
- Gitee：https://gitee.com/cnt-code/ergalics-studio
- 问题反馈：https://gitee.com/cnt-code/ergalics-studio/issues

---

**English Summary**

Ergalics Studio is an open-source, browser-based scientific computing workstation. v2.0.0 is its first official release: a 4-mode workbench (interactive canvas / visual flow / multi-language code / block editor), 107 built-in plugins across 16 disciplines, 26 standalone research tools, live WebGPU compute with 14 reusable WGSL kernels (including a real-time Schwarzschild ray tracer, FDTD wave solver and Nishita atmosphere), a browser workspace VFS with Git integration, reproducibility kernels, and a sandboxed plugin SDK with signed packages. No installation required — open the URL above and start computing.

**Full Changelog**: https://gitee.com/cnt-code/ergalics-studio/blob/main/CHANGELOG.md
