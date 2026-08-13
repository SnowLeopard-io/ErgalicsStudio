# Ergalics Studio

> 浏览器端专业科学计算工作站工业化脚手架 · A browser-based scientific computing workstation scaffold.

Ergalics Studio 是一个"浏览器里的科学计算操作系统骨架"——所有按钮可点、所有面板可开、所有接口可通，真正的计算能力由第三方插件注入。

详见需求文档 [`需求文档.md`](./需求文档.md)（v3.0）。

## 技术栈

| 层 | 技术 |
|:---|:---|
| 原生层 | Rust + wasm-bindgen，WebGPU 设备管理与 Compute 调度框架 |
| 前端 | React 18 + TypeScript + Vite |
| 路由 | React Router（Hash 路由，兼容 GitHub Pages） |
| 状态 | Zustand |
| 存储 | IndexedDB（项目 / 插件包）+ localStorage（偏好） |
| 部署 | GitHub Pages（纯静态） |

## 快速开始

```bash
npm install

# 构建 WASM 原生层（首次需安装 wasm-bindgen-cli，脚本会自动安装）
npm run build:wasm

# 开发服务器
npm run dev

# 生产构建（含 WASM 编译 + 类型检查）
npm run build

# 预览构建产物
npm run preview
```

> 注：`src/native/ergalics_core.js` 中已内置一个 stub，未构建 WASM 时前端可正常构建/运行并优雅降级。

## 目录结构

```
project/
├── src/                      # 前端（React + TS）
│   ├── api/                  # （预留）宿主 API 聚合
│   ├── components/           # 通用组件（Dropdown/Modal/ParamPanel/…）
│   ├── core/                 # 核心服务（gpu/wasm/storage/events/perf/…）
│   ├── i18n/                 # 国际化（zh-CN / en-US）
│   ├── native/               # WASM 绑定产物（构建生成）
│   ├── pages/                # welcome / workbench / settings / plugin / share
│   ├── plugins/builtin/      # 内置示例插件（点云 / 粒子）
│   ├── stores/               # Zustand stores
│   ├── styles/               # 主题变量 + 全局样式
│   └── types/                # 领域类型（project/plugin/…）
├── native/ergalics-core/     # Rust WASM crate
├── scripts/build-wasm.mjs    # WASM 构建脚本
├── scripts/make-example-projects.mjs  # 重新生成示例 .clproj 工程
├── examples/                 # 样例数据与示例工程
│   ├── data/                 #   diamond.xyz / crystal.xyz / galaxy.dat / telemetry.csv / dataset.json
│   └── projects/             #   point-cloud-demo / crystal-lattice-demo / particles-demo (.clproj)
├── .github/workflows/        # GitHub Pages 部署流水线
└── 需求文档.md               # 需求设计文档 v3.0
```

## 样例数据与示例工程

### 内置示例数据

工作台中央区域的 **"示例数据"** 按钮可直接加载内置样例，无需准备文件：

| 数据 | 格式 | 目标插件 | 说明 |
|:---|:---|:---|:---|
| `diamond.xyz` | `.xyz` | 点云查看器 | 2000 点斐波那契球面 |
| `crystal.xyz` | `.xyz` | 点云查看器 | 512 原子简立方晶格 |
| `galaxy.dat` | `.dat` | 粒子模拟 | 3000 粒子（位置 + 速度） |
| `telemetry.csv` | `.csv` | 粒子模拟 | 240 行涡轮遥测时间序列 |
| `dataset.json` | `.json` | 粒子模拟 | 结构化测量数据 + 质量信息 |

样例数据位于 `examples/data/`，通过 Vite `?raw` 在构建时打包进应用（见 `src/core/examples.ts`）。

### 示例工程（.clproj）

`examples/projects/` 提供三个可直接打开的项目文件（含完整数据与场景状态），在工作台点 **"打开项目"** 即可恢复：

- `point-cloud-demo.clproj` — 点云查看器 + 球面数据，预设参数。
- `crystal-lattice-demo.clproj` — 点云查看器 + 晶体点阵。
- `particles-demo.clproj` — 粒子模拟 + 星系数据，自动开始模拟。

修改 `examples/data/` 后重新生成工程文件：

```bash
node scripts/make-example-projects.mjs
```

## 核心能力

- **插件系统**：`.cspkg`（ZIP）包格式、manifest 校验、生命周期（发现/安装/加载/激活/停用/卸载）、注册表、事件总线通信、错误隔离。
- **项目管理**：IndexedDB 持久化、新建/打开/保存/另存为/删除、最近项目、自动保存、`.clproj` 导入导出、Ctrl+S。
- **数据加载**：文件选择、拖拽、扩展名 + Magic Number 双重格式检测、多插件路由选择。
- **国际化**：中英双语，localStorage → `navigator.language` → 默认 的检测顺序，即时生效。
- **主题**：亮色/暗色/跟随系统，CSS 变量设计令牌，防闪屏预注入脚本。
- **性能监控**：FPS/帧耗时/GPU 耗时/显存/数据规模采集，悬浮可拖动看板，低帧率等告警。
- **错误处理**：应用级/组件级/插件级三层错误边界，WebGPU/WASM/存储降级策略。
- **分享**：lz-string 压缩生成分享链接、导出 `.clproj`、导出场景截图。

## 插件开发

一个插件是 ESM 模块，导出工厂函数返回实现了生命周期接口的对象：

```ts
export default function createPlugin(): Plugin {
  return {
    manifest: { id: 'com.example.myplugin', name: 'My Plugin', version: '1.0.0',
                author: 'me', description: '…', entry: 'index.js' },
    init(api) { /* … */ },
    destroy() { /* … */ },
    activate(ctx) { /* 接管中央区域 ctx.container */ },
    deactivate() { /* … */ },
    render(container) { /* 渲染到 container.dom / container.canvas2d */ },
    updateParams(params) { /* … */ },
    getParams() { return [/* 参数控件定义 */]; },
    getSupportedFormats() { return [{ extension: '.xyz', mimeTypes: [] }]; },
  };
}
```

完整接口见 [`src/types/plugin.ts`](./src/types/plugin.ts)。

## 构建 WASM

```bash
# 依赖：rustup target add wasm32-unknown-unknown；wasm-bindgen-cli（脚本自动安装）
npm run build:wasm
```

产物写入 `src/native/`，前端通过动态 import 加载并支持重试降级。

## 部署

推送 `main` 分支后 GitHub Actions 自动：编译 WASM → 构建前端 → 部署到 `gh-pages`。访问地址为 `https://<user>.github.io/<repo>/`。

## License

MIT
