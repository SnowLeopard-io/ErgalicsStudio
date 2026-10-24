# 贡献指南 / Contributing to Ergalics Studio

感谢你有兴趣参与贡献。Ergalics Studio 是一个基于浏览器的科学计算工作站：
前端采用 React + TypeScript，核心是编译为 WebAssembly 的 Rust 代码，配备
WebGPU 计算管线，并为第三方扩展提供插件架构。

Thanks for your interest in contributing. Ergalics Studio is a
browser-based scientific-computing workstation: a React + TypeScript
frontend, a Rust core compiled to WebAssembly, a WebGPU compute pipeline, and
a plugin architecture for third-party extensions.

本指南介绍如何构建项目、运行各项检查，以及让一次改动通过评审并合并。

This guide covers how to build the project, run the checks, and get a change
reviewed and merged.

---

## 目录 / Table of Contents

- [开发环境准备 / Development setup](#开发环境准备--development-setup)
- [可用脚本 / Available scripts](#可用脚本--available-scripts)
- [项目结构 / Project layout](#项目结构--project-layout)
- [工作流程 / Workflow](#工作流程--workflow)
- [提交规范 / Commit conventions](#提交规范--commit-conventions)
- [代码风格 / Code style](#代码风格--code-style)
- [测试 / Testing](#测试--testing)
- [添加插件 / Adding a plugin](#添加插件--adding-a-plugin)
- [添加示例数据 / Adding sample data](#添加示例数据--adding-sample-data)
- [文档 / Documentation](#文档--documentation)
- [PR 检查清单 / Pull request checklist](#pr-检查清单--pull-request-checklist)

---

## 开发环境准备 / Development setup

### 前置要求 / Prerequisites

- Node.js 22 或更新版本（CI 使用 Node 22）
- Node.js 22 or newer (the CI runs Node 22)
- npm 10 或更新版本
- npm 10 or newer
- E2E 套件需要一款基于 Chromium 的浏览器（Playwright 驱动本机安装的
  Microsoft Edge）
- A Chromium-based browser for the E2E suites (Playwright drives the locally
  installed Microsoft Edge)

### 安装 / Install

```sh
npm install
```

### 原生核心（Rust 编译为 WebAssembly） / Native core (Rust to WebAssembly)

GPU 计算路径附带一个编译为 WebAssembly 的 Rust 核心。生成的绑定文件
（`src/native/*.js`、`src/native/*.wasm`）是不纳入 git 的构建产物——全新
clone 之后，首次运行 `npm run dev` / `npm run build` 前必须先构建它们：

The GPU compute path ships a Rust core compiled to WebAssembly. The generated
bindings (`src/native/*.js`, `src/native/*.wasm`) are git-untracked build
artifacts — after a clean clone you must build them before the first
`npm run dev` / `npm run build`:

```sh
npm run build:wasm
```

该构建需要安装了 `wasm32-unknown-unknown` target 的 Rust 工具链。如果本机
没有 Rust，`npm run build:web` 会改用 stub 模块（纯 WebGPU 后端仍然可用；
见 `scripts/make-wasm-stub.mjs`）。

The build requires a Rust toolchain with the `wasm32-unknown-unknown` target.
If Rust is unavailable, `npm run build:web` uses a stub module instead (the
raw WebGPU backend still works; see `scripts/make-wasm-stub.mjs`).

### 开发模式运行 / Run in development

```sh
npm run dev
```

打开终端打印出的 URL（默认 `http://localhost:5173`）。

Open the printed URL (default `http://localhost:5173`).

### 文档站点（VitePress） / Docs site (VitePress)

```sh
npm run docs:dev
```

---

## 可用脚本 / Available scripts

| 脚本 / Script        | 作用 / What it does |
| --------------------- | -------------------------------------------------------------------- |
| `npm run dev`         | 启动 Vite 开发服务器 / Start the Vite dev server |
| `npm run build`       | 完整构建：WASM 绑定 + 类型检查 + Vite + 文档 / Full build: WASM bindings + typecheck + Vite + docs |
| `npm run build:web`   | 仅 Web 构建（类型检查 + Vite + 文档，无 Rust 步骤）/ Web-only build (typecheck + Vite + docs, no Rust step) |
| `npm run build:wasm`  | 重新生成 Rust/WASM 绑定 / Regenerate the Rust/WASM bindings |
| `npm run typecheck`   | `tsc --noEmit`（strict 模式）/ `tsc --noEmit` (strict mode) |
| `npm run test`        | 单元测试（Vitest）/ Unit tests (Vitest) |
| `npm run test:e2e`    | 全部 E2E 套件（Playwright + Edge）/ All E2E suites (Playwright + Edge) |
| `npm run verify`      | `typecheck` + 单元测试——开 PR 前的最低门槛 / `typecheck` + unit tests — the minimum bar before opening a PR |

---

## 项目结构 / Project layout

```
src/
├── core/                 # host services: GPU compute, wasm loader, sandbox,
│                         #   viewports, events, data files, examples
├── plugins/
│   ├── builtin/          # built-in plugins (core auto-loaded + fun/utility)
│   ├── marketplace.ts    # marketplace catalog (tags / popularity / filters)
│   └── ...               # third-party .cspkg loading
├── blocks/               # Flow mode: registry / compiler / executor / catalog
├── editor/               # Block + Code modes: shared IR, Blockly, codegen, runtime
├── components/           # React components (param panel, dialogs, editors)
├── pages/                # welcome, workbench, settings, share, plugin pages
├── stores/               # Zustand stores
├── types/                # plugin & project & editor contracts
├── native/               # generated WASM bindings (git-untracked)
examples/
├── data/                 # sample datasets (served to the sample dialog)
├── projects/             # sample Flow pipelines (.clproj)
└── code/                 # sample Python programs
docs/                     # VitePress site (guide/*.md)
scripts/                  # build, data generation, and E2E verification
tests/                    # unit tests (Vitest)
```

---

## 工作流程 / Workflow

1. 动手之前，先查看现有 issue 和 `docs/guide/prd.md` 中的任务列表；如果
   打算处理某个 issue，请在该 issue 下留言说明。
2. Check the open issues and the task list in `docs/guide/prd.md` before
   starting; comment on an issue if you plan to work on it.
3. 复刻（fork）本仓库，并从 `main` 创建分支：
   ```sh
   git checkout -b feat/my-change
   ```
4. Fork the repository and create a branch from `main`:
   ```sh
   git checkout -b feat/my-change
   ```
5. 进行修改，保持改动小而聚焦；一个分支只包含一个逻辑改动。
6. Make your changes, keeping them small and focused. One logical change per
   branch.
7. 运行本地检查（见[测试](#测试--testing)）。
8. Run the local checks (see [Testing](#测试--testing)).
9. 推送分支，并向 `main` 发起 pull request。填写 PR 模板，附上测试证据和
   截图。
10. Push the branch and open a pull request against `main`. Fill in the PR
    template, including the test evidence and screenshots.

---

## 提交规范 / Commit conventions

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope): ...` —— 新增能力（插件、block、模式、API）
- `feat(scope): ...` — a new capability (plugin, block, mode, API)
- `fix(scope): ...` —— 缺陷修复
- `fix(scope): ...` — a bug fix
- `chore(scope): ...` —— 工具链、依赖、CI
- `chore(scope): ...` — tooling, dependencies, CI
- `docs(scope): ...` —— 仅文档
- `docs(scope): ...` — documentation only
- `refactor(scope): ...` —— 不改变行为的重构
- `refactor(scope): ...` — behavior-preserving restructuring
- `test(scope): ...` —— 仅测试
- `test(scope): ...` — tests only

示例：

Examples:

```
feat(ai-training): train MNIST CNN with live loss curve
fix(compute): pass GPUBufferBinding object to createBindGroup
docs(plugins): document the AI Trainer plugin
```

主题行控制在约 72 个字符以内，使用祈使语气，结尾不加句号。

Keep the subject under ~72 characters, in the imperative mood, without a
trailing period.

---

## 代码风格 / Code style

- 启用 TypeScript strict 模式（`strict`、`noUnusedLocals`、
  `noUnusedParameters`、`noUncheckedIndexedAccess`）。整个代码库必须能通过
  `tsc --noEmit` 的干净检查，请保持这一状态。
- TypeScript, strict mode enabled (`strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`). The codebase type-checks
  cleanly with `tsc --noEmit`; keep it that way.
- 所有面向用户的字符串、注释和文档均使用英文；UI 通过 `src/i18n/`
  （zh-CN / en-US）做本地化，block 与插件元数据通过 `nameI18n` /
  `descriptionI18n` 做本地化。
- All user-facing strings, comments, and docs are written in English; the UI
  is localized through `src/i18n/` (zh-CN / en-US) and block/plugin metadata
  through `nameI18n` / `descriptionI18n`.
- 优先使用小型、纯粹、可测试的模块；副作用（事件、store）在边界处注入或
  隔离。
- Prefer small, pure, testable modules. Side effects (events, stores) are
  injected or isolated at the edges.
- 2 空格缩进、单引号、不写分号——与周围代码保持一致。
- 2-space indentation, single quotes, no semicolons — match the surrounding
  code.

---

## 测试 / Testing

### 单元测试（Vitest） / Unit tests (Vitest)

```sh
npm run test
```

单元测试位于 `tests/`，运行在 Node 环境中。保持测试自包含；涉及模块级状态
时，使用 `vi.resetModules()` + `vi.doMock` + 动态 `import`。

Unit tests live in `tests/` and run in a Node environment. Keep tests
self-contained; for module-level state use `vi.resetModules()` + `vi.doMock`
+ a dynamic `import`.

### E2E 测试（Playwright + Edge） / E2E suites (Playwright + Edge)

```sh
npm run test:e2e
```

`scripts/verify-*.mjs` 中的 E2E 套件会针对 `vite preview` 构建产物驱动真实
浏览器。它们覆盖核心链路：欢迎页、插件激活、示例加载、GPU 计算、
Block / Code 模式，以及 AI Training 插件。

The E2E suites in `scripts/verify-*.mjs` drive a real browser against a
`vite preview` build. They cover the core loop: welcome page, plugin
activation, sample loading, GPU compute, Block/Code modes, and the AI
Training plugin.

**新增功能时，请添加（或扩展）一个 `verify-*.mjs` 脚本**，并将其接入
`package.json` 中的 `test:e2e` 脚本。

**When you add a feature, add (or extend) a `verify-*.mjs` script** and wire
it into the `test:e2e` script in `package.json`.

### 持续集成 / CI

CI 工作流（`.github/workflows/ci.yml`）在每次 push 和 pull request 时运行
以下步骤：

The CI workflow (`.github/workflows/ci.yml`) runs, on every push and pull
request:

1. `npm ci`
2. `npm ci`
3. `npm run typecheck`
4. `npm run typecheck`
5. `npm test`
6. `npm test`
7. 为原生模块打 stub（CI 中没有 Rust 工具链）
8. Stub native module (no Rust toolchain in CI)
9. `npm run build:web`
10. `npm run build:web`

pull request 必须在以上所有步骤上保持绿色（全部通过）。

A pull request must be green on all of these.

---

## 添加插件 / Adding a plugin

内置插件位于 `src/plugins/builtin/`。插件契约（`getParams`、`loadData`、
`compute`、`render`、`updateParams`）在
[`docs/guide/plugins.md`](docs/guide/plugins.md) 中有深入说明。

Built-in plugins live in `src/plugins/builtin/`. The plugin contract
(`getParams`, `loadData`, `compute`, `render`, `updateParams`) is documented
in depth in [`docs/guide/plugins.md`](docs/guide/plugins.md).

新增一个内置插件的最低要求清单：

The minimal checklist for a new built-in plugin:

1. 在 `src/plugins/builtin/<name>/` 中创建一个模块，导出 manifest 和一个
   工厂函数。
2. Create a module in `src/plugins/builtin/<name>/` exporting a manifest and a
   factory function.
3. 在 `src/plugins/builtin/index.ts` 中注册它（除非启动开销可以忽略，否则
   声明 `autoload: false`）。
4. Register it in `src/plugins/builtin/index.ts` (declare `autoload: false`
   unless startup cost is negligible).
5. 在 `src/plugins/marketplace.ts` 中添加它的 marketplace 元数据。
6. Add its marketplace metadata in `src/plugins/marketplace.ts`.
7. 随插件提供一份示例数据集（见下文），让示例对话框能够一键加载。
8. Ship a sample dataset (see below) so the 示例 dialog can load it with one
   click.
9. 添加一个 E2E 脚本（`scripts/verify-*.mjs`），并将其纳入 `test:e2e`。
10. Add an E2E script (`scripts/verify-*.mjs`) and include it in `test:e2e`.
11. 更新 `README.md` 与 `docs/guide/plugins.md`。
12. Update `README.md` and `docs/guide/plugins.md`.

---

## 添加示例数据 / Adding sample data

所有内置示例数据存放在 `examples/data/` 下，并在构建时打包。有两条规则
需要注意：

All built-in sample data lives under `examples/data/` and is bundled at build
time. Two rules matter:

- 每个插件的示例文件应放在 `examples/data/` 的**子目录**中（如
  `examples/data/ai/`）。`src/core/dataFiles.ts` 中的注册 glob 不是递归的；
  直接放进 `examples/data/` 的 CSV 会被急切地打包进主应用，导致启动产物
  膨胀。
- Keep per-plugin sample files in a **subdirectory** of `examples/data/`
  (e.g. `examples/data/ai/`). The registry glob in `src/core/dataFiles.ts`
  is non-recursive; a CSV dropped directly into `examples/data/` gets eagerly
  bundled into the main app and bloats the startup payload.
- 在 `src/core/examples.ts`（`BUILTIN_EXAMPLES`）中注册示例。大文件应通过
  `import.meta.glob` 提供惰性 `loadContent`，而不是急切的 `?raw` 导入，
  以免被打进主 bundle。
- Register the sample in `src/core/examples.ts` (`BUILTIN_EXAMPLES`). For
  large files, provide a lazy `loadContent` via `import.meta.glob` instead of
  an eager `?raw` import so it stays out of the main bundle.

示例数据应通过 `scripts/` 下的脚本（使用带种子的 PRNG）确定性地生成并提交
入库，这样学习者可以直接查看这些文件，且每次构建都可复现。

Sample data should be generated deterministically by a script under
`scripts/` (seeded PRNG) and committed, so learners can inspect the files
directly and every build is reproducible.

---

## 文档 / Documentation

- 用户指南位于 `docs/guide/`（VitePress），发布在
  `https://snowleopard-io.github.io/ErgalicsStudio/docs/`。
- The user guide lives in `docs/guide/` (VitePress) and is served at
  `https://snowleopard-io.github.io/ErgalicsStudio/docs/`.
- `README.md` 是项目门面：四种工作台模式、插件列表（新增插件时更新）以及
  架构亮点。
- `README.md` is the landing page: four workbench modes, the plugin list
  (updated when plugins are added), and architecture highlights.
- 行为发生变化时，请更新相关文档；如果插件数量或能力发生变化，还需更新
  `README.md` 与 `docs/guide/plugins.md` 中的计数。
- When you change behavior, update the relevant doc and, if the plugin count
  or capabilities change, the counts in `README.md` and
  `docs/guide/plugins.md`.
- `docs/` 中的截图按章节（模式 / 插件）组织，而不是集中放在一个混合图库里。
- Screenshots in `docs/` are organized by section (mode / plugin), not in one
  combined gallery.

---

## PR 检查清单 / Pull request checklist

发起 pull request 之前，请确认：

Before opening a pull request, confirm:

- [ ] `npm run verify` 通过（类型检查 + 单元测试）/ `npm run verify` passes (typecheck + unit tests)
- [ ] 新行为有单元测试和/或 E2E 覆盖，且 E2E 脚本已接入 `test:e2e` / New behavior has unit and/or E2E coverage, and E2E scripts are wired into `test:e2e`
- [ ] `npm run build:web` 构建成功 / `npm run build:web` succeeds
- [ ] 涉及可视效果的改动已附截图，并归入受影响的模式 / 插件章节 / Screenshots, where visual, are attached and grouped under the affected mode / plugin section
- [ ] 若改动影响 `README.md` / `docs/guide/*`，已相应更新 / `README.md` / `docs/guide/*` are updated if the change affects them
- [ ] 不包含无关改动 / No unrelated changes are included
