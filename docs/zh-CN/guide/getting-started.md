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
