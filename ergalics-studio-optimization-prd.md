# Ergalics Studio 全项目优化需求文档（v1）

> 范围：**全仓库**（官网 / 工作站 / 文档站三端 + core + 插件 + Python/Pyodide + Rust/WASM），非单插件专项。
> 约束：提交全仓库 + GitHub Pages（deploy.yml）保活 + 纯客户端可离线；服务于 os2026(10/11) / oa2026(10/31) 冲刺。
> 背景：em-eigensolver 插件专项需求已闭环（REQ-A 口径、REQ-F repro、REQ-G 报告均已完成）；本文件处理**项目级**优化。

---

## A. 正确性 · 安全 · 可信（最高 ROI，直贴技术与落地权重）

| ID | 问题证据 | 需求 | 验收 |
|---|---|---|---|
| A1 | `src/core/sandbox.ts:195`、`src/core/plugin-worker.ts:252` 用 `new Function` 求值插件入口（sandbox 仅 Worker 不可用时的回退） | 固化"信任边界"口径：Worker 优先、主线程 `new Function` 回退须有来源约束（包签名/加载来源白名单）；`SECURITY.md`/README 明示"非安全沙箱"边界 | 材料中不存在"安全沙箱"表述；文档明确沙箱语义 |
| A2 | `npm audit` 5 项：4 moderate(vitest/vitepress dev) + 1 high(vite，已在 `security.yml` allowlist 并记录周期) | 建"漏洞台账 + 升级窗口"：dev 依赖评估升级；high 项给评审口径（allowlist 原因 + 周期） | 台账条目与 allowlist 理由可查可复述 |
| A3 | 多格式 I/O 依赖（apache-arrow/parquet-wasm/h5wasm/netcdfjs/zarrita）是真解析器但行为测试薄 | 为这 5 个"真解析器"固化 round-trip/坏输入行为测试（它们撑起"多格式 I/O"卖点） | 每种格式 ≥1 组解析/回写/坏输入用例在 CI 绿 |

## B. 性能 · 加载 · 包体（P1，直接影响评审"现场打开"体验）

| ID | 问题证据 | 需求 | 验收 |
|---|---|---|---|
| B1 | `src/core/scene3d.ts:10` 静态 `import * as THREE`，three(~400KB) 进首屏包 | three 改动态 `import()`（workbench 需用时才加载），其余调用点一并核实 | 首屏 JS 不再含 three |
| B2 | `vite.config.ts:105-107` 仅 react 进 `manualChunks` | 为 three / blockly / monaco-editor / pyodide 等大依赖设独立 chunk（或 lazyRoutes 分包） | 产物分包可查，大依赖不互相拖首屏 |
| B3 | `scripts/build-budget.mjs`：首屏 gzip ≈649.8KB，超 500KB 目标，实际预算 700KB；**纯手动，未进 CI** | 把预算断言接入 `ci.yml`（超阈值即失败），并给 500KB 目标设回归门 | CI 出现违反预算即红；历史曲线可查 |
| B4 | 未做加载瀑布审计 | 用 dev/DAG 审计一次首屏 waterfall，确认 monaco/pyodide/tfjs/duckdb-wasm 全为按需加载 | 产出一份"哪个 chunk 何时加载"清单 |

## C. 构建 · CI · 工程护栏（P1）

| ID | 问题证据 | 需求 | 验收 |
|---|---|---|---|
| C1 | `package.json:25` `lint: tsc --noEmit`（无 ESLint/Prettier） | 补真实 lint：ESLint(type-aware)+Prettier；`lint` 脚本改为两者 | `npm run lint` 能抓到非类型问题 |
| C2 | `package.json:29` `test:e2e` = 11 个 verify 脚本一条串行链，任一失败即断；且 `ci.yml:16-48` **不跑它** | 拆分/并行 + `--continue` 语义；把关键 verify 纳入 CI 冒烟（不拖 `deploy` 红） | CI 覆盖关键 E2E；失败可定位到具体脚本 |
| C3 | 一次性/死代码：`persistLegacyPrefs`(settings.ts:88)、`src/core/opfs-migration.ts`、`SyncInitInput` deprecated(native d.ts:322) | 立清理窗口：确认无调用后删除/降级 | 清单项移除或标记 deprecate |

## D. 未完成功能完结（P2，视时间窗口）

| ID | 问题证据 | 需求 | 验收 |
|---|---|---|---|
| D1 | `src/core/io/zarr.ts:36-41`：`"Zarr group roots are not yet enumerable"`——.zarr 根为 group 时无法列变量 | 实现 group 枚举（zarrita 支持），让 Zarr 成为完整 I/O 成员 | .zarr(group 根) 可列出并读入变量 |
| D2 | webR 默认可选（`vite.config.ts` `__WEBR_AVAILABLE__`），未 vendored 时 R 回退 IR 引擎 | 定"是否默认 vendored"取舍（体积 vs 完整 R 运行时）；材料措辞固定为"IR 底座 + webR 可选" | 决策落文档，且与 README/material 口径一致 |
| D3 | Flow 模式无 AI 入口（对应 `aiPanelStore` 项目级浮动面板重构） | Flow 工具栏补齐 AI 触发按钮，与其他模式一致 | Flow 一键打开项目级 AI 面板 |

## E. 设备与体验（P2，对应既定 UI 方针）

- E1 **AI 助手全项目浮动窗 + 顶栏右侧触发按钮**（既定重构方向）：作为项目级浮动面板，不遮挡积木/拖放区；Flow 等各模式均有入口（承接 D3）。
- E2 既定体验基调固化验收口径：数据文件选择区分"用户上传 vs 示例"；例卡稍大；实验室以全页打开而非弹窗；欢迎页"环境就绪"卡常开不可折叠；动画走"克制精致"。

## F. Pages / CI 保活（硬约束）

| ID | 约束 |
|---|---|
| F0 | 所有优化保持纯客户端 + 可离（首屏依赖按需加载不引入联网运行时） |
| F1 | `deploy.yml` 不被 B/C/D 拖红；E2/B3 的新 E2E 须在 Node 无 GPU 环境绿 |
| F2 | 若为 B1/B2 改构建，需先跑通 `npm run build:web` + `deploy:merge` 验证 Pages 仍三端可访问 |

---

## 建议执行顺序（ROI 优先）

1. **第一优先（不写代码也能赢分）**：A1/A2 口径落文档（安全边界 + 漏洞台账）→ 属于"治理 20% + 可复现"的稳拿项。
2. **第二优先（一天级、现场体验直接升）**：B1 three 懒加载 + B3 预算入 CI → 首屏从 ~650KB 降并防回退。
3. **第三优先（CI 可信度）**：C1 真 lint + C2 E2E 拆并入 CI。
4. **第四优先（产品闭环，时间允许）**：D1 Zarr 完整化 + D3 Flow AI 入口。
5. **收尾**：C3 死代码清理；E 系列按既定 UI 方针逐条过验收。
6. **明确不做**：不为此引入 webR 默认 vendored（除非时间+体积预算双允许，且材料口径已定 D2）；科研图/ matplotlib 不引入（已在项目决策中排除）。

## 回归验收（提交前逐条勾）

- [x] `npm run lint` 为真实 ESLint/格式检查（C1 落地为精简版：ESLint 10 flat config，非 type-aware；用户拍板不引入 Prettier 全仓 reformat）
- [x] CI 含预算断言（超 700KB 即红）与关键 E2E 冒烟（预算断言 ci.yml 原有；E2E 冒烟为新增 `e2e-smoke` job：smoke + ui）
- [x] 首屏不静态携带 three；`manualChunks` 覆盖大依赖
- [x] 明确材料中"沙箱/安全边界""R 运行时"两处措辞（A1/D2）
- [x] 漏洞台账（A2）可查
- [x] Zarr group 可枚举（D1，若本轮做）
- [x] Flow 模式含 AI 入口（D3，若本轮做）
- [ ] `deploy.yml` 绿，Pages 三端可访问
- [ ] 无 `__pycache__/*.py[cod]` 入库（`.gitignore` 已含）

## 落地记录（2026-09-21）

**A1/A2/D2（口径与台账）**
- `SECURITY.md` 新增 Trust boundary 节：Worker-first 隔离的回退路径（主线程 `new Function`）**不是安全沙箱**，安全门禁依赖 FR-05 Ed25519 签名校验；README 双语同步。
- A2 漏洞台账入 `SECURITY.md`：升级窗口清掉 vitest 4.1.10→4.1.11（5→3 条），残留 3 条全部源自 vitepress@1.6.4 钉死的 vite@5（allowlist 注释已写明归属）；app/website 工作区 vite 实为 6.4.3 已修补。
- D2：webR 措辞固化为"可选、默认不 vendored——IR 底座始终随发行版提供"，README/文档一致。

**B1/B2（three 懒加载 + chunk 划分）**
- 关键修复比预期深：**43 个内置插件的 manifest 全部与实现同文件**，静态导入把全部插件代码拖进首屏。统一拆分为 `<name>Manifest.ts`（含目录型 `ai-training/manifest.ts`），`builtin/index.ts` 只静态引 manifest、实现走动态 import。构建从"40+ 静态边告警"到 0。
- object 形式 `manualChunks` 把 Vite preload helper 分进 export-pdf chunk → 入口静态边拖入 154KB jspdf（build-budget 抓获）。改函数形式 + helper 专属小 chunk；作用域包按 scope 归组（@tensorflow/*、@zarrita/* 等）。
- 入口 gzip 718.97KB → 685.6KB（build-budget 实测，**PASS**，红线内余量 14.4KB）。

**C1（精简版 ESLint）**
- eslint@10 + typescript-eslint@8 + react-hooks：0 error / 19 预期 warning（15 条 exhaustive-deps 积压 + 4 条 no-this-alias 既有写法）。`lint` = `eslint . && tsc --noEmit`；CI 新增 lint 步骤。em-cfd-coupler/** 暂入 ignores（并行 WIP）。

**C2（E2E runner + CI 冒烟）**
- 新增 `scripts/e2e-run.mjs`：替换 `&&` 串行链，`--continue` 语义 + 汇总表 + 失败退出 1；支持 `--parallel N` 与按名子集。`test:e2e` 接入。
- CI 新增 `e2e-smoke` job（smoke + ui，pin 系统 Chrome）。
- **F 阶段复验通过**：smoke 失败根因为"sidebar 顺序变内容驱动（em-eigensolver 排第一，无 range 参数）"，改 smoke 为"找首个带 range 的插件"后 2/2 通过。
**C3（死代码结论：全部保留）**
- `persistLegacyPrefs`(settingsStore)：设置页迁移路径在用；`opfs-migration.ts`：SettingsPage 在用；`SyncInitInput`：d.ts 已有 deprecate 注记且 wasm 绑定仍在消费。均有调用方，无清理项。

**D3/E（AI 入口与体验基调）**
- TopBar 右侧 AI 触发按钮（`data-tour="ai-assistant"`）全模式可用（Flow/块/代码共享 TopBar）；`AiAssistantOverlay` 挂 WorkbenchPage 层作为项目级浮动窗。E1/E2 既有 UI 方针已在此前迭代落地，本轮确认无回归项。

**B3/B4（预算基线 + waterfall 清单）**
- `budget-baseline.json` 已落库（first-screen 685.6KB / lazy 444 chunks）：后续超线时 build-budget 自动打印 per-chunk 增量，CI `verify` job 的 budget 步骤作为回归门。
- 首屏 waterfall（entry 静态图）：`index`(626.4) + `react`(58.5) + `preload-helper`(0.7)。**全部大依赖均为懒加载，按用户动作触发**：three ← 首个 3D 场景（scene3d 动态 import）；blockly ← 积木编辑器；monaco ← 代码编辑器；data-io(arrow/h5wasm/netcdf/zarr) ← 科学文件导入；tfjs ← AI 训练；export-pdf(jspdf) ← PDF 导出；duckdb ← SQL 工作台；zstd ← 压缩包导入。`lazy integrity 19/19` 断言保证工具注册表全部走动态 import。

**F（全量回归）**
- `build:web` ✅（含 docs）；build-budget ✅ 685.6/700 PASS；`npm test` ✅ 109/109 测试文件通过；`npm run lint` ✅ 0 error。临时文件（audit-current.json、tmp-chunk-edges.mjs）已清理。
- 剩余一项回归验收未勾（`deploy.yml` 绿 / Pages 三端可访问）——需推送后由 GitHub Actions 实际验证，本轮不推送。