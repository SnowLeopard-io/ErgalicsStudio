# 安全政策（Security Policy）

Ergalics Studio 完全在浏览器中运行。第三方插件代码默认隔离在 Web Worker 中；
安全模型在 `docs/guide/plugins.md` 中有描述。我们认真对待安全报告，并会尽快
作出回应。

Ergalics Studio runs entirely in the browser. Third-party plugin code is
isolated in a Web Worker by default; the security model is described in
`docs/guide/plugins.md`. We take security reports seriously and respond as
quickly as we can.

## 信任边界（Trust boundary，在假定“沙箱即安全”之前请先阅读）

- **Worker 优先隔离（Worker-first isolation，§6.2）**：`sandbox: "isolated"`
  插件运行在 Web Worker 中，通过类型化的 postMessage RPC 桥通信——无法访问宿主
  全局对象、DOM 或 store。这是一种*隔离*机制，**不是强化的安全沙箱**：它的设计
  目的不是困住执意的恶意作者，本项目的任何材料中也都未声称过这样的保证。
- **Worker-first isolation (§6.2)**: `sandbox: "isolated"` plugins run in a
  Web Worker with a typed postMessage RPC bridge — no host globals, DOM, or
  store access. This is an *isolation* mechanism, **not a hardened security
  sandbox**: it was not designed to contain a determined malicious author,
  and no such guarantee is claimed anywhere in this project's materials.
- **主线程回退（Main-thread fallback）**：当 Worker 不可用时，`loadCspkg` 会以
  尽力收紧的 `new Function` 作用域求值插件入口（`evaluatePluginLegacy`，模式为
  `"legacy-fallback"`）。存在确定的逃逸手段（如 constructor 链）。该回退从不会
  对未通过签名门禁（signature gate，见下文）的包运行，但它仍是最弱的执行模式，
  UI 会在其启用时发出警告。
- **Main-thread fallback**: when Workers are unavailable, `loadCspkg`
  evaluates the entry with a best-effort restricted `new Function` scope
  (`evaluatePluginLegacy`, mode `"legacy-fallback"`). A determined escape
  (constructor chains, etc.) exists. This fallback never runs for packages
  that failed the signature gate — see below — but it is still the weakest
  execution mode and the UI warns when it engages.
- **来源约束（Source constraint，FR-05）**：每次 `.cspkg` 加载都要通过 Ed25519
  签名门禁（signature gate）（`src/core/plugin-signing.ts`），该检查*独立于
  沙箱决策*：被篡改的包必定抛出异常；未签名或密钥未知的包需要用户明确确认信任
  后才能安装。`sandbox: "trusted"` 包按设计拥有完整的页面访问权限，只对用户
  自己掌控的包才有意义。
- **Source constraint (FR-05)**: every `.cspkg` load passes an Ed25519
  signature gate (`src/core/plugin-signing.ts`) *independent of the sandbox
  decision*: tampered packages always throw; unsigned or unknown-key packages
  require an explicit user trust confirmation before they can install.
  `sandbox: "trusted"` packages run with full page access by design and only
  make sense for packages the user controls.
- 插件作者被视为半可信的协作者，而非对手。请勿安装你不信任的 `.cspkg` 文件；
  对已存储的数据而言，最后一道防线是浏览器的同源策略（same-origin policy），
  而不是这个沙箱。
- Plugin authors are treated as semi-trusted collaborators, not adversaries.
  Do not install `.cspkg` files you do not trust; the browser's same-origin
  policy (not this sandbox) is the last line of defense for stored data.

## 报告漏洞（Reporting a vulnerability）

**请不要为安全漏洞创建公开 issue。**请改用 GitHub 的私密漏洞报告：

**Please do not open a public issue for a security vulnerability.** Use
GitHub's private vulnerability reporting instead:

1. 进入仓库的 **Security** 标签页。
1. Go to the repository's **Security** tab.
2. 选择 **Report a vulnerability**（位于 "Private vulnerability reporting"
   之下）。
2. Select **Report a vulnerability** (under "Private vulnerability
   reporting").
3. 填写详情：受影响的组件、最小复现、影响，以及（如果有的话）建议的修复方案。
3. Fill in the details: affected component, a minimal repro, impact, and a
   suggested fix if you have one.

如果你更偏好邮件，请联系维护者 <1486853830@qq.com>，并在主题前加上
`[SECURITY]`。

If you prefer email, contact the maintainers at
<1486853830@qq.com> and prefix the subject with `[SECURITY]`.

以下信息有助于我们快速分诊：

What helps us triage quickly:

- 涉及的组件与文件（插件沙箱、CSPKG 加载器、WebGPU/WASM 路径、文件路由等）
- Component and file(s) involved (plugin sandbox, CSPKG loader, WebGPU/WASM
  path, file routing, etc.)
- 一个最小、自包含的复现
- A minimal, self-contained reproduction
- 问题是否可由不受信任的 `.cspkg` 包、不受信任的数据文件，或嵌入了本应用的
  恶意网站触发
- Whether the issue is exploitable from an untrusted `.cspkg` package, an
  untrusted data file, or a malicious website embedding the app
- 浏览器与平台版本
- Browser and platform versions

## 响应时效（Response expectations）

- **确认收到**：收到报告后 48 小时内。
- **Acknowledgment**: within 48 hours of receiving a report.
- **分诊 / 修复计划**：一周内确认问题并给出计划。
- **Triage / fix plan**: within one week, we confirm the issue and share a
  plan.
- **修复**：严重问题优先处理；目标是随补丁版本发布修复。如果问题在修复发布前
  即可被利用，我们会与你协调披露时间。
- **Fix**: critical issues are prioritized; we aim for a fix in a patch
  release. We coordinate disclosure timing with you if the issue is
  exploitable before the fix ships.

## 支持的版本（Supported versions）

| 版本 Version | 支持情况 Supported |
| ------- | ------------------ |
| main | 是（最新） Yes (latest) |
| 已发布标签 Released tags | 尽力支持 Best effort |

本项目处于活跃开发阶段，尚未维护长期支持分支；修复会最先落在 `main` 上。

The project is under active development and does not yet maintain a
long-term-support branch; fixes land on `main` first.

## 范围（Scope）

在范围内：

In scope:

- 插件沙箱与 `.cspkg` 加载管线
- The plugin sandbox and `.cspkg` loading pipeline
- WebGPU / WASM 计算路径
- The WebGPU / WASM compute path
- 文件解析与文件路由逻辑（包括示例数据）
- File parsing and file-routing logic (including sample data)
- 任何能让不受信任的包或文件影响宿主页面的途径
- Anything that lets an untrusted package or file affect the host page

不在范围内（不承诺修复）：

Out of scope (no fix promised):

- 上游依赖中已被上游修复的漏洞——请改为升级该依赖
- Vulnerabilities in upstream dependencies already fixed upstream — upgrade
  the dependency instead
- 需要用户已经在使用 `sandbox: 'trusted'` 插件运行不受信任代码才能触发的问题
  （受信任插件按设计即拥有页面访问权限）
- Issues that require a user to already be running untrusted code with
  `sandbox: 'trusted'` plugins (trusted plugins run with page access by
  design)

## 依赖漏洞台账（Dependency vulnerability ledger，A2）

`npm audit` 的发现由定时运行的 `security.yml` 每周审查，并在每月的**升级窗口**
（每月首次评审；若定时检查变红则提前）由人工重新分诊。阻断策略：除非在
`security.yml` 中以 `AUDIT_ALLOWLIST` 附带理由显式加入允许清单，否则
high/critical 级通告会使 CI 失败；moderate 级发现在此处跟踪。

`npm audit` findings are reviewed weekly by the scheduled `security.yml` run
and re-triaged by a human during a monthly **upgrade window** (first review
of each month; earlier if a scheduled run turns red). Blocking policy:
high/critical advisories fail CI unless explicitly allow-listed in
`security.yml` (`AUDIT_ALLOWLIST`) with a reason; moderate findings are
tracked here.

截至 **2026-10-13** 的状态：`npm audit` 零发现。依赖树中只有单一
`vite@6.4.4`（已修复）与单一 `esbuild@0.25.12`（已修复），全部工作区
（app / website / docs）共享同一节点；docs 工作区运行
`vitepress@2.0.0-alpha.6`（其 `vite: ^6.3.5` 区间与根工作区去重）。
当前无在册发现：

State as of **2026-10-13**: `npm audit` reports zero findings. The tree
carries a single `vite@6.4.4` (patched) and a single `esbuild@0.25.12`
(patched), shared by every workspace (app / website / docs); the docs
workspace runs `vitepress@2.0.0-alpha.6`, whose `vite: ^6.3.5` range
dedupes against the root workspace. No findings are currently on the
ledger.

已在 2026-09-21 升级窗口中清除：

Cleared in the 2026-09-21 upgrade window:

- `@vitest/mocker` + `vitest` — GHSA-82fw-gwwq-j7x9（经 mocker redirect mock
  的路径穿越，仅开发/测试环境）— 通过将 vitest 从 4.1.10 升级到 4.1.11 修复。
- `@vitest/mocker` + `vitest` — GHSA-82fw-gwwq-j7x9 (path traversal via
  mocker redirect mock, dev/test only) — fixed by upgrading
  vitest 4.1.10 → 4.1.11.

已在 2026-10-01 升级窗口中清除：

Cleared in the 2026-10-01 upgrade window:

- `undici` — GHSA-rfgv-xxqx-mfg5（经由未被请求的 WebSocket 子协议造成的 DoS）
  与 GHSA-w293-vg96-wgc3（`BalancedPool` 丢弃 connect 选项导致的 TLS 证书校验
  绕过），以及同一节点上的另外九条通告——通过将 undici 从 7.29.0 升级到 7.30.0
  修复。经由 `jsdom`（vitest 的可选 peer，仅测试环境）传递；jsdom 的
  `^7.25.0` 下限已接纳该补丁，因此不需要 `overrides` 条目。
- `undici` — GHSA-rfgv-xxqx-mfg5 (DoS via unrequested WebSocket subprotocol)
  and GHSA-w293-vg96-wgc3 (TLS certificate validation bypass via dropped
  connect options in `BalancedPool`), plus nine further advisories on the
  same node — fixed by upgrading undici 7.29.0 → 7.30.0. Transitive via
  `jsdom` (vitest's optional peer, test environment only); jsdom's `^7.25.0`
  floor admits the patch, so no `overrides` entry was needed.
- `dompurify` — GHSA-p98j-92pf-mc4p（通过 `IN_PLACE` 移除节点的
  `afterSanitize` 钩子造成的 DOM XSS）— 通过将 dompurify 从 3.4.14 升级到
  3.4.16 修复。经由 `jspdf` 的可选依赖传递。
- `dompurify` — GHSA-p98j-92pf-mc4p (DOM XSS via `IN_PLACE` node-removing
  `afterSanitize` hook) — fixed by upgrading dompurify 3.4.14 → 3.4.16.
  Transitive via `jspdf`'s optional dependencies.

已在 2026-10-10 升级窗口中清除：

Cleared in the 2026-10-10 upgrade window:

- `vue` + `@vue/server-renderer` — GHSA-g2v6-rqmx-r4w6（属性名黑名单缺失 CR
  导致的 XSS）— 通过刷新 lockfile 使 vue 从 3.5.41 升级到 3.5.43 修复。经由
  docs 工作区的 `vitepress@1.6.4`（`vue: ^3.5.13`）传递；补丁版本本就满足该
  下限，因此无需改动 manifest——只是已提交的 lockfile 过期了。
- `vue` + `@vue/server-renderer` — GHSA-g2v6-rqmx-r4w6 (XSS via a missing CR
  in the attribute-name blacklist) — fixed by refreshing the lockfile so vue
  3.5.41 → 3.5.43. Transitive via the docs workspace's `vitepress@1.6.4`
  (`vue: ^3.5.13`); the patched release already satisfies that floor, so no
  manifest change was needed — the committed lockfile had simply gone stale.
- `source-map-js` — GHSA-68fv-2mgg-jv7q（经带索引的 source-map section 偏移
  造成的事件循环 DoS）— 通过将 source-map-js 从 1.2.1 刷新到 1.2.2 修复。经由
  `@vue/compiler-core`、`@vue/compiler-sfc`、`css-tree` 与 `postcss`
  （`^1.2.1`）传递；同样是 lockfile 过期这一根因。
- `source-map-js` — GHSA-68fv-2mgg-jv7q (event-loop DoS via indexed source-map
  section offsets) — fixed by refreshing source-map-js 1.2.1 → 1.2.2.
  Transitive via `@vue/compiler-core`, `@vue/compiler-sfc`, `css-tree` and
  `postcss` (`^1.2.1`); same stale-lockfile root cause.

随上述工作一并交付的依赖解析修复（peer 冲突，非安全通告）：`blockly@13.2.1`
声明了必需的 peer `jsdom >=27.4.0 <30.0.0`，因此 TRAE 批次引入的
`jsdom: ^30.1.2` devDependency 会使 `npm ci` 因 ERESOLVE 而失败，并在任何步骤
运行之前就导致 `verify` / `e2e-smoke` / `audit` / `sbom` 任务失败。jsdom 已
回退固定到 `^29.1.1`（blockly 能接受的最新版本；测试套件运行于 `node` 环境
且从不导入 jsdom，因此该降级没有运行时影响）。这也使 undici 保持在上述已修复
的 7.30.0。

Dependency-resolution fix shipped alongside the above (peer conflict, not an
advisory): `blockly@13.2.1` declares the required peer
`jsdom >=27.4.0 <30.0.0`, so the `jsdom: ^30.1.2` devDependency introduced in
the TRAE batch broke `npm ci` with ERESOLVE and failed the `verify` /
`e2e-smoke` / `audit` / `sbom` jobs before any step ran. jsdom is pinned back
to `^29.1.1` (the latest release blockly accepts; the test suite runs in the
`node` environment and never imports jsdom, so the downgrade has no runtime
impact). This also keeps undici at the patched 7.30.0 noted above.

已在 2026-10-13 升级窗口中清除：

Cleared in the 2026-10-13 upgrade window:

- `vite` / `esbuild` / `vitepress` — GHSA-fx2h-pf6j-xcff（high，
  `server.fs.deny` 在 Windows 备用路径上的绕过）、GHSA-4w7w-66w2-5vf9 与
  GHSA-v6wh-96g9-6wx3（moderate，同一 lockfile 节点）以及
  GHSA-67mh-4wv8-2f99（moderate，esbuild 开发服务器请求伪造）——通过将
  docs 工作区从 `vitepress@1.6.4` 升级到 `vitepress@2.0.0-alpha.6` 修复。
  该 alpha 的 `vite: ^6.3.5` 区间与根工作区已修复的 `vite@6.4.4` 去重为
  同一节点，`esbuild` 也随之收敛到单一已修复的 `0.25.12`，因此无需
  `overrides` 条目。选 alpha.6 而非 alpha.18+ 的原因：后者的
  `vite: ^8.2.1` 需要的 esbuild `^0.27.0 || ^0.28.0` 与根工作区 vite 6 的
  esbuild `^0.25.0` 无法共存，会触发 npm arborist 的错误去重（树中出现
  invalid 节点）。配套改动：修复 `docs/product/Ergalics-Studio.md` 中两处
  断链的截图相对路径（`sql-workbench.png` / `notebook.png` 缺少
  `laboratory/` 层级；vitepress 1 时代的死链在 2.x 的资源解析下构建失败），
  并在 `docs/.vitepress/config.mts` 中设置 `vite.ssr.noExternal: true`，
  规避 vitepress 2 SSR 产物以目录路径外部化 `vue/server-renderer` 触发的
  `ERR_UNSUPPORTED_DIR_IMPORT`。构建（client + server + 全部页面渲染）与
  dev 服务器均已实测通过。
- `vite` / `esbuild` / `vitepress` — GHSA-fx2h-pf6j-xcff (high,
  `server.fs.deny` bypass on Windows alternate paths), GHSA-4w7w-66w2-5vf9
  and GHSA-v6wh-96g9-6wx3 (moderates on the same lockfile node), and
  GHSA-67mh-4wv8-2f99 (moderate, esbuild dev-server request forgery) —
  fixed by upgrading the docs workspace from `vitepress@1.6.4` to
  `vitepress@2.0.0-alpha.6`. That alpha's `vite: ^6.3.5` range dedupes
  into the same node as the root workspace's patched `vite@6.4.4`, and
  `esbuild` collapses to a single patched `0.25.12`, so no `overrides`
  entry is needed. alpha.6 was chosen over alpha.18+ because their
  `vite: ^8.2.1` requires esbuild `^0.27.0 || ^0.28.0`, which cannot
  coexist with the root vite 6's esbuild `^0.25.0` and triggers a
  mis-dedupe in npm arborist (an invalid node in the tree). Shipped
  alongside: two dead relative paths for screenshots in
  `docs/product/Ergalics-Studio.md` (`sql-workbench.png` /
  `notebook.png` missing the `laboratory/` segment — dead links from the
  vitepress 1 era that fail 2.x asset resolution at build time), and
  `vite.ssr.noExternal: true` in `docs/.vitepress/config.mts` to avoid the
  `ERR_UNSUPPORTED_DIR_IMPORT` caused by vitepress 2's SSR bundle
  externalizing `vue/server-renderer` as a directory path. Build (client +
  server + full page rendering) and the dev server were both verified.
- `sprintf-js` / `argparse` / `@tensorflow/tfjs` —
  GHSA-hp3w-g68c-fv3c（moderate，无界精度说明符造成的 DoS）——上游没有
  任何已修补版本（全部已发布版本 ≤ 1.1.3 均受影响），因此无法以版本提升
  修复；通过根 `package.json` 的 `overrides` 将 `argparse` 钉到 `2.0.1`
  修复：argparse ≥ 2.0.0 彻底移除了对 sprintf-js 的依赖，sprintf-js 由此
  从依赖树整体消失。唯一的 argparse 消费方 `@tensorflow/tfjs` 仅在
  manifest 中声明它，其 dist 产物不含任何 `require("argparse")` 调用
  （已全量 grep 验证），浏览器包因此不受影响；tfjs 的 aggregate moderate
  随之清除。`security.yml` 中的 `AUDIT_ALLOWLIST` 条目已移除（机制保留、
  置空备用），`npm install` 与 `npm audit` 现为零告警。
- `sprintf-js` / `argparse` / `@tensorflow/tfjs` —
  GHSA-hp3w-g68c-fv3c (moderate, DoS through unbounded precision
  specifiers) — unfixable by any version bump: upstream has released no
  patched version (every published release ≤ 1.1.3 is affected). Fixed by
  pinning `argparse` to `2.0.1` via the root `package.json` `overrides`:
  argparse ≥ 2.0.0 dropped its sprintf-js dependency entirely, removing
  sprintf-js from the tree. The only argparse consumer,
  `@tensorflow/tfjs`, declares it in the manifest only — its dist code
  contains no `require("argparse")` call at all (verified by a full grep),
  so the browser bundle is unaffected and tfjs's aggregate moderate is
  cleared with it. The `AUDIT_ALLOWLIST` entry in `security.yml` was
  removed (the mechanism is kept, empty, for future exemptions);
  `npm install` and `npm audit` are now fully warning-free.

## 路线图中的安全加固（Security hardening on the roadmap）

公开路线图（`docs/guide/roadmap.md`）追踪以下加固工作：内容安全策略
（content security policy）响应头、worker 资源限制（内存 / CPU），以及审计
日志系统。`.cspkg` 包的包签名（Ed25519）已实现并被强制执行（`FR-05`、
`src/core/plugin-signing.ts`）。

The public roadmap (`docs/guide/roadmap.md`) tracks the following
hardening work: content security policy headers, worker resource limits
(memory / CPU), and an audit log system. Package signing (Ed25519) for
`.cspkg` packages is already implemented and enforced (`FR-05`,
`src/core/plugin-signing.ts`).

## 无赏金计划（No bounty program）

本项目目前不提供漏洞赏金或其他经济回报。但在征得你同意的前提下，我们会在安全
通告中致谢研究人员。

This project does not currently offer a bug bounty or other financial reward.
We do, with your permission, credit researchers in the security advisory.
