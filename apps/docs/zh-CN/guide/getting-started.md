# 快速开始

## 前置条件

- **Node.js ≥ 20** 和 npm
- 带有 `wasm32-unknown-unknown` 目标及 `wasm-bindgen-cli` 的 **Rust 工具链**——仅构建原生核心时需要。缺少 WASM 模块时，前端会逐级降级（并进行重试），因此可以快速完成仅前端的配置。

## 安装与运行

```bash
npm install
npm run dev
```

进入工作台之前，欢迎页会对硬件进行自检（WebGPU、WASM、IndexedDB）并显示结果。

## 在线录入与编辑插件数据

在工作台中使用图表、统计及各学科插件时，**无需切换到 Excel 或其他软件生成 CSV / JSON**：

1. **查看数据要求**：激活任意数据插件后，右侧面板顶部会直接显示该插件的**数据契约卡片**（必填/可选列、数据类型、单位与范围约束）。
2. **在线编辑与实时联动**：点击 **✎ 在线编辑** 会在画布底部打开可拖拽抽屉编辑器（默认开启**实时联动**，修改单元格后 300ms 自动刷新画布与科学指标栏；右上角可一键 **⤢ 展开浮窗**）。表格编辑器支持直接从 Excel/网页 `Ctrl+V` 块粘贴、撤销/重做与单元格级实时校验，JSON 插件则使用带 Schema 自动补全的 Monaco 编辑器。
3. **一键模板与列映射**：可点击 **✦ 载入模板** 快速体验；导入表头不一致的外部 CSV 时，系统会自动弹出**列映射确认窗口**而非直接报错。
4. **与全局项目数据同步**：在线编辑的结果可一键**保存到项目数据**（覆盖原文件或另存为新文件），供其他兼容插件、代码/流程模式及科研套件共同复用；在顶栏「数据」弹窗中也会自动标注每个文件对当前插件的兼容状态（`✓ 兼容` / `⇄ 需映射` / `✕ 不匹配`），并可直接点 **✎** 在线修订。

## 构建

```bash
npm run build          # wasm → 类型检查 → vite 构建 → 复制文档
npm run build:web      # 仅前端
npm run build:wasm     # 将 Rust 核心重新构建到 src/native
```

`npm run build` 总是先重新构建 WASM 核心，以确保发布到 `dist/` 的绑定为最新版本。`src/native/` 下的构建产物（`.js`、`.wasm`）被 git 忽略；只有生成的 `.d.ts` 文件受版本控制。

## 测试

```bash
npm test          # 单元测试（Vitest）
npm run test:e2e  # 对生产预览运行 Playwright 测试套件
npm run verify    # 类型检查 + 单元测试
```

## 文档站点

文档是一个独立的 VitePress 工作区：

```bash
cd docs
npm install
npm run dev       # 本地文档站点
npm run build     # 静态站点 → docs/.vitepress/dist
```

主构建会将文档产物复制到 `dist/docs/`，因此欢迎页的 **Docs** 链接在预览服务器上可用。站点也可以独立部署（例如部署到 GitHub Pages）。

## 复现示例数据

示例数据集以确定性方式生成（使用带种子的 LCG），因此可以安全地重新生成：

```bash
node scripts/make-example-data.mjs
```

这会重写 `examples/data/*` 以及 `src/core/exampleAssets.ts` 中的 base64 图像资源。
