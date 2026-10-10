# 需求文档：Git-backed Project & 版本控制系统

> **优先级**：P0 | **模块**：Core / Project / Collaboration
> **状态**：规划中 | **目标里程碑**：M6

---

## 1. 背景与动机

### 1.1 现状痛点
- 项目仅以 `.clproj` 单文件形式保存（IndexedDB + 导出 ZIP），无版本历史、无分支、无合并
- 课题组协作靠「传文件/微信发 ZIP」，冲突解决全靠人工
- 实验记录、代码、数据、图表、论文分离存储，无法追溯「哪个 commit 产生了这张图」
- 无法接入现有科研基础设施（GitHub/GitLab/Gitea、CI/CD、代码审查）

### 1.2 核心目标
**把「项目」变成「Git 仓库」**：每个 `.clproj` 即一个 Git 仓库，原生支持版本控制、分支实验、PR 审阅、CI 自动化。

---

## 2. 用户故事

| 编号 | 角色 | 故事 | 验收标准 |
|------|------|------|----------|
| US-01 | 科研人员 | 新建项目时自动 `git init`，生成标准目录结构与 `.gitignore` | 打开项目即可 `git log` 看到初始提交 |
| US-02 | 科研人员 | 每次自动保存/手动保存可选生成 commit（含 runs/figures/manuscript 变更） | `git log --oneline` 清晰展示实验演进 |
| US-03 | 课题组长 | 查看某张 Figure 的完整溯源：commit → run → data → code | Lineage 页面点击「Open in Git」跳转对应 commit |
| US-04 | 协作者 | Clone 仓库后直接在 Ergalics Studio 打开，无需导入 | `File → Open from Git URL` 一键拉取并打开 |
| US-05 | 科研人员 | 实验分支：`git checkout -b exp/new-method` 并行探索，合并回主干 | 分支切换瞬间恢复完整工作台状态 |
| US-06 | 审稿人/合作者 | 对特定 Run/Figure/Manuscript 段落发起评论/审阅 | 右键「Comment」→ GitHub/Gitea PR comment 或本地 annotation |
| US-07 | CI 系统 | Push 触发自动跑管道、生成 Figure、校验 repro.lock、打包 Supplement | `.github/workflows/ergalics.yml` 开箱即用 |

---

## 3. 功能规格

### 3.1 仓库目录结构标准化

```
<project-root>/
├── .git/
├── .gitignore                 # 自动生成，见 3.2
├── project.clproj             # 核心项目文件（Zustand 状态序列化）
├── runs/                      # 每次 Run 一个 JSON（含 metrics/params/inputsHash）
│   ├── run-<uuid>.json
│   └── index.json             # runId → {label, source, createdAt, hash} 索引
├── figures/                   # Figure Studio sheets
│   ├── sheet-<uuid>.json
│   └── exports/               # SVG/PDF/PNG 导出产物
├── manuscript/                # Manuscript 编辑器产物
│   ├── main.tex               # 或 main.md / manuscript.json
│   ├── refs.bib               # BibTeX 文献库
│   ├── figures/               # 论文用图软链接或副本
│   └── build/                 # 编译产物
├── data/                      # 大文件建议走 Git LFS 或外部存储
│   └── .gitattributes         # LFS tracking rules
├── code/                      # Code/Block/Flow 导出的可运行脚本
│   ├── pipeline.py
│   └── analysis.R
├── repro.lock                 # 复现锁文件（已有）
├── supplement/                # Supplement 打包产物
│   └── supplement-<timestamp>.zip
└── .ergalics/                 # IDE 内部元数据（不进 Git）
    ├── workspace.json         # UI 状态：打开的标签、面板布局
    └── cache/                 # 本地缓存
```

### 3.2 `.gitignore` 模板

```gitignore
# Ergalics Studio local state
.ergalics/
*.log
.DS_Store

# Large data files (use Git LFS instead)
data/*.h5
data/*.nc
data/*.parquet
data/*.zarr/

# Build artifacts
manuscript/build/
figures/exports/
supplement/*.zip

# Runtime
node_modules/
dist/
*.wasm
```

### 3.3 Git 操作集成层 (`src/core/git/`)

```typescript
// src/core/git/adapter.ts
export interface GitAdapter {
  // 仓库初始化
  init(repoPath: string, template?: 'standard' | 'minimal'): Promise<void>;
  clone(url: string, targetPath: string, opts?: CloneOptions): Promise<void>;
  
  // 状态查询
  status(repoPath: string): Promise<GitStatus>;
  log(repoPath: string, opts?: LogOptions): Promise<GitCommit[]>;
  diff(repoPath: string, opts?: DiffOptions): Promise<string>;
  
  // 写操作
  add(repoPath: string, files: string[]): Promise<void>;
  commit(repoPath: string, message: string, opts?: CommitOptions): Promise<string>; // 返回 commit hash
  checkout(repoPath: string, ref: string): Promise<void>;
  branch(repoPath: string, name: string, startPoint?: string): Promise<void>;
  merge(repoPath: string, branch: string): Promise<MergeResult>;
  
  // 远程
  push(repoPath: string, remote: string, branch: string): Promise<void>;
  pull(repoPath: string, remote: string, branch: string): Promise<void>;
  fetch(repoPath: string, remote: string): Promise<void>;
  
  // 钩子
  installHooks(repoPath: string, hooks: GitHook[]): Promise<void>;
}

export interface GitStatus {
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  currentBranch: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: { name: string; email: string };
  timestamp: number;
  parents: string[];
  // Ergalics 扩展字段
  runIds?: string[];
  figureIds?: string[];
  manuscriptChanged?: boolean;
}
```

**实现策略**：
- **浏览器端**：使用 `isomorphic-git` (纯 JS) + IndexedDB 作为文件系统后端（`idb-fs`）
- **Node/桌面端**：直接调用系统 `git` 二进制（`simple-git` 或 `child_process`）
- 统一接口 `GitAdapter`，运行时根据环境注入实现

### 3.4 自动提交策略

| 触发时机 | 默认行为 | 可配置项 |
|----------|----------|----------|
| 项目创建 | `chore: init project` | ✅ 必须 |
| 手动保存 (Ctrl+S) | `save: <project name>` | 可关闭/改为手动 |
| 自动保存 (30s 间隔) | 不提交，仅更新工作区 | 可开启 `autoCommitOnAutosave` |
| Run 完成 | `run: <label> (source=<flow\|block\|code>)` | ✅ 默认开启 |
| Figure 保存 | `figure: <sheet title>` | ✅ 默认开启 |
| Manuscript 保存 | `manuscript: <section>` | 可配置防抖 |
| 导出 Supplement | `release: supplement v<date>` | ✅ 默认开启 |

**Commit Message 规范** (Conventional Commits + Ergalics 扩展)：
```
<type>(<scope>): <subject>

[optional body: runId, figureId, metrics summary]

[optional footer: Refs #issue, Co-authored-by: ...]
```
Types: `chore` | `save` | `run` | `figure` | `manuscript` | `data` | `code` | `release` | `repro`

### 3.5 Workbench UI 集成

#### 3.5.1 Git 面板 (左侧 Sidebar 新增 Tab)
```
┌─────────────────────────────────────┐
│ 🌿 Git          [Pull] [Push] [Sync] │
├─────────────────────────────────────┤
│ Branch: main ▲  ↑2 ↓1               │
├─────────────────────────────────────┤
│ 📝 Unstaged Changes (3)             │
│   ● project.clproj                  │
│   ● runs/run-abc123.json            │
│   ○ data/new-data.csv               │
├─────────────────────────────────────┤
│ 📦 Staged Changes (1)               │
│   ● manuscript/main.tex             │
├─────────────────────────────────────┤
│ 📜 Recent Commits                   │
│   a1b2c3d run: normalize+plot       │
│   e4f5g6h figure: Figure 3          │
│   i7j8k9l manuscript: Methods       │
└─────────────────────────────────────┘
```

#### 3.5.2 文件级 Diff 查看器
- 复用 Monaco Diff Editor
- 支持 `.clproj` 语义化 diff（忽略 UI 状态字段，高亮 runs/figures 变更）
- Figure diff：SVG 叠加对比 / 像素级差异热图

#### 3.5.3 历史溯源跳转
- Lineage 图谱节点右键 → `Open Commit` → Git 面板定位到该 commit
- Run 记录列表 → `View Commit` → 查看该次实验完整上下文
- Manuscript 段落 → `Git Blame` → 逐行追溯作者/时间

### 3.6 预置 Git Hooks (`.ergalics/hooks/` → 安装到 `.git/hooks/`)

| Hook | 校验内容 | 失败处理 |
|------|----------|----------|
| `pre-commit` | `repro.lock` 存在且校验通过 | 阻止提交，提示 `npm run repro:verify` |
| `pre-commit` | Figure 分辨率 ≥ 300dpi / 字体嵌入 | 警告不阻断 |
| `pre-commit` | Manuscript 引用完整性 (bib 条目存在) | 警告 |
| `pre-push` | 运行核心单测 (`npm run test:unit -- --filter=core`) | 可配置跳过 |
| `post-checkout` | 自动恢复工作区状态 (打开的标签、当前模式) | 静默恢复 |

---

## 4. 非功能需求

| 指标 | 目标 |
|------|------|
| 仓库初始化耗时 | < 2s (浏览器端 isomorphic-git) |
| 单次 commit 延迟 | < 500ms (含索引更新) |
| 10k commits 历史加载 | < 3s (分页加载，虚拟列表) |
| 仓库体积 (纯代码/文档) | < 100MB 推荐；大数据走 LFS |
| 离线工作 | 完全支持，联网时自动同步 |
| 并发冲突 | 乐观锁 + 三方合并 (project.clproj 语义合并) |

---

## 5. 技术实现计划

### Phase 1: 核心适配器 (2 周)
- [ ] `src/core/git/adapter.ts` 接口定义
- [ ] `src/core/git/isomorphic-adapter.ts` (isomorphic-git + idb-fs)
- [ ] `src/core/git/node-adapter.ts` (Node 环境，桌面端/Electron 用)
- [ ] 单元测试：init/status/add/commit/log/diff/checkout/branch

### Phase 2: 项目集成 (1.5 周)
- [ ] `ProjectStore` 集成：保存时自动 `git add/commit`
- [ ] `.clproj` 语义化序列化（稳定 key 排序，便于 diff）
- [ ] `runs/` `figures/` `manuscript/` 目录自动维护
- [ ] `.gitignore` / `.gitattributes` / hooks 自动生成与安装

### Phase 3: UI 面板 (2 周)
- [ ] `GitPanel` 组件 (Sidebar 新增)
- [ ] `GitStatusBar` (StatusBar 右侧：branch + sync 状态)
- [ ] `CommitDialog` (暂存/撰写 message/提交)
- [ ] `DiffViewer` (Monaco 集成)
- [ ] `HistoryLog` (虚拟列表 + 搜索/筛选)

### Phase 4: 协作与远程 (2 周)
- [ ] `CloneDialog` (Git URL / GitHub/GitLab/Gitea OAuth)
- [ ] `RemoteManager` (多 remote、凭据管理、SSH Key)
- [ ] `PushPullDialog` (冲突解决向导)
- [ ] `PRIntegration` (GitHub/Gitea API：创建 PR、评论同步)

### Phase 5: CI/CD 模板 (1 周)
- [ ] `.github/workflows/ergalics.yml` 模板生成器
- [ ] 预置 Job：`validate` / `test` / `build-figures` / `check-repro` / `pack-supplement`
- [ ] 状态徽章生成 (README 注入)

---

## 6. 兼容性与迁移

### 6.1 现有项目迁移
```typescript
// 首次打开旧 .clproj 时自动执行
async function migrateToGit(project: Project): Promise<void> {
  const repoPath = await getProjectRepoPath(project.id);
  await git.init(repoPath);
  await writeProjectFiles(repoPath, project); // 展开为标准目录结构
  await git.add(repoPath, ['.']);
  await git.commit(repoPath, 'chore: migrate to git-backed project');
  // 更新项目元数据：存储模式 = 'git'
}
```

### 6.2 双模式共存
- `Project.meta.storageMode: 'legacy' | 'git'`
- 旧项目可一键「升级为 Git 仓库」，不强制迁移
- 导入/导出 `.clproj` 保持兼容（展开/打包目录结构）

---

## 7. 验收标准

| 场景 | 验收步骤 | 通过条件 |
|------|----------|----------|
| 新建项目 | `File → New Project` → 打开终端 `git log` | 看到初始提交，目录结构符合 3.1 |
| 实验分支 | `Git Panel → New Branch` → 修改参数跑 Run → 切回 main → Merge | 分支独立，合并无冲突，Lineage 正确 |
| 协作克隆 | 同事 `File → Open from Git URL` 输入 GitHub 链接 | 无需手动 `git clone`，直接进入工作台 |
| 历史溯源 | Figure Studio 右键图表 → `Open Commit` | Git 面板定位到生成该图的 commit |
| CI 集成 | Push 到 GitHub → Actions 跑通 | 生成 Figure、校验 repro.lock、产出 Supplement ZIP |
| 离线工作 | 断网编辑 → 保存 → 恢复网络 → Push | 无数据丢失，自动同步 |

---

## 8. 依赖与风险

| 依赖 | 版本 | 说明 |
|------|------|------|
| isomorphic-git | ^1.25.0 | 纯 JS Git 实现，浏览器端核心 |
| idb-fs | ^1.0.0 | IndexedDB 虚拟文件系统 |
| simple-git | ^3.25.0 | Node 端调用系统 git (可选) |
| monaco-editor | 已有 | Diff Editor 复用 |

**风险**：
- 浏览器端 IndexedDB 存储上限 (通常 1-2GB) → 大项目建议桌面端/服务端
- `isomorphic-git` 性能在大仓库 (10k+ commits) 可能瓶颈 → 虚拟化 + 浅克隆优化
- 二进制大文件 (HDF5/Parquet) → 强制 Git LFS，文档化最佳实践

---

## 9. 相关文档

- ADR-001: Git as Project Storage（../architecture/adr-001-git-backed-project，待创建）
- Manuscript Editor Requirements（02，待创建）
- Collaboration & Real-time Editing Requirements（03，待创建）
- [Roadmap: M6 Git Integration](../guide/roadmap.md#m6--git-backed-project--collaboration)

---

## 10. 变更记录

| 版本 | 日期 | 作者 | 变更摘要 |
|------|------|------|----------|
| 0.1 | 2026-10-04 | Architect | 初稿：核心功能、目录结构、Git 适配器、UI 集成、实施计划 |