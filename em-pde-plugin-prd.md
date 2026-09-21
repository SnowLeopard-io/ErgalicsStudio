# em-pde-solver 插件需求文档（AI CFD 商飞赛题）

> 依据赛题：`ai_cfd_zXnsRXJxwR.pdf`（商飞企业赛题，与"电磁谐振"同属商飞、**同一评审口径**：算法正确25 / 性能20 / 稳定性15 / 任务定义15 / 创新15 / 可复现10，硬指标合计 60%）。
> 定位：以**插件形式**复用 em-eigensolver 工程底座，新增「网格 + PDE 求解 + 正确性对照 + 公平对比 + 可视化」。

---

## 0. 目标

在 Ergalics Studio 内新增一个**插件 `em-pde-solver`**（镜像 `em-eigensolver` 架构），吃住赛题的四个核心诉求：
1. **代表性 PDE 求解**：泊松 / Helmholtz（含特征值），多轮网格缩放 n: 100→1e5；
2. **正确性量化**：与解析解/参考解对比（L₂ 误差、收敛阶、特征值残差）；
3. **性能三角色对比**：单线程 vs 多线程（BLAS/Pyodide），内存峰值，公平跨机口径；
4. **可复现 + 公平对比 + 可视化**：复用 `repro.json` + `diag-report` + 网格/解场/收敛曲线可交互视图。

与 `em-eigensolver` 双线并投，同一套工程资产打两张卷。

---

## 1. 复用资产清单（零改 / 直连）

| 复用项 | 来源 | 用途 |
|---|---|---|
| 稀疏矩阵 + CSR | `python/em_eigensolver/csr.py` | PDE 离散后组装出的 A、A−σI 稀疏结构 |
| 特征值内核 | `lanczos.py` / `lobpcg.py` / `jacdavid.py` | Helmholtz/特征值问题的谱求解（JD 供位移逆） |
| 不定系统 MINRES | `minres.py` | 泊松（正定）位移逆、内层线性解 |
| 位移策略 / 口径 | `solver.py`（相对残差口径） | 收敛判定，直接沿用 |
| 参数扫描 | `sweep.py` | 网格多轮扫描 / 物理系数扫描 |
| 可复现凭证 | `repro.py` | 每例 `repro.json`：矩阵指纹 + 参数哈希 + seed + 代码快照 + 结果摘要 |
| 诊断报告 | `diag-report.ts` | 每例自包含离线 HTML（谱/残差/收敛/场） |
| 前端骨架 | `em-worker.ts` / `em-client.ts` / `plugin.ts` / `types.ts` | Worker 桥 + 控制面板 + 状态 |
| 可视化 | `render.ts` / `render3d.ts`（模态场/热图/3D） | 解场热图、网格、3D 复用扩展 |
| benchmark | `benchmarks/perf_bench.py` + `bench/*.json` | 性能/内存/正确性成表 |

## 2. 新增功能需求

### P0 —— 能成题的最小闭环

| ID | 需求 | 验收 |
|---|---|---|
| P0.1 | **网格生成** `pde_grid.py`：1D/2D/均匀/非均匀，按规模序列 n=100/400/1600/…→1e5 自动多轮缩放 | 给定 n 生成对应节点/单元，可输出规模表 |
| P0.2 | **PDE 离散** `operators.py`：泊松（−Δu=f）、Helmholtz（−Δu=λu）算子组装 CSR；可选介质系数 | 离散矩阵与手算小例一致；复现 `io_matrix` 兼容 |
| P0.3 | **求解路由**：正定线性（泊松）走 MINRES；特征值（Helmholtz）走 lanczos/JD；σ 位移逆支持 | 与 `solver` 同口径，真实残差认证 |
| P0.4 | **正确性对照** `analytic.py`：解析解/参考解 + L₂/L∞ 误差 + 收敛阶估计 | 每规模给误差与阶，随 n 单调下降 |
| P0.5 | **公平对比台** `verify.py`：单线程 vs 多线程、内存峰值、公平跨机口径；输出对比表 JSON | 生成 `bench/em-pde-results.json`：正确性 + 性能 + 内存 + 复现 |
| P0.6 | **可视化界面**：网格视图 + 解场热图 + 收敛曲线 + 网格缩放表，同工作台插件内展示 | 评审当场上手跑一例即可见 |

### P1 —— 提分增强

| ID | 需求 | 验收 |
|---|---|---|
| P1.1 | **解析解预置库**：泊松（含 Dirichlet/Neumann）、Helmholtz 若干已知谱，供对照 | 对照数据集随插件分发 |
| P1.2 | **多物理示例映射**：电磁（复用 eigensolver）、散热/结构小例 → 微波与"工业软件场景落地" | 材料可按赛题多物理叙事引用 |
| P1.3 | **diag-report 的 PDE 扩展**：并入网格规模、PDE 系数、误差/阶、性能三参 → 一键导出离线报告 | 报告字段含正确性与性能 |
| P1.4 | **repro 全覆盖**：每个求解/对照/性能运行都产出 `repro.json` | 所有 `bench/*.json` 可复现 |

### P2 —— 打磨（时间允许）

- 3D 网格/解场可视化与 `render3d` 复用的完善；
- 非均匀/自适应网格对比；
- 与"受限内网 / 数据不出本机"叙事进一步贴合的资料页。

## 3. 架构（镜像 em-eigensolver）

```
src/plugins/builtin/em-pde-solver/
  em-worker.ts         # Pyodide 桥（import linux 后端可选）
  em-client.ts         # 前端 client
  plugin.ts            # 控制面板：问题选择/网格n/PDE系数/算子/求解器/视图
  render.ts            # 网格 + 解场热图 + 收敛曲线
  render3d.ts          # (P2) 3D 复用
  diag-report.ts       # 离线诊断报告
  types.ts
  python/em_pde/
    pde_grid.py        # 网格生成与多轮缩放
    operators.py       # PDE 离散 → CSR
    analytic.py        # 解析解/参考对照 + 误差/阶
    verify.py          # 公平对比台 + 性能/内存/复现
    solver_compat.py   # 复用 em_eigensolver 的 csr/minres/lanczos/jd
  python/benchmarks/   # perf_bench 扩展
  python/tests/
```

## 4. 性能与诚实边界（评审口径）

- 浏览器/Pyodide 数值性能与原生 Matlab 不拼"秒级绝对速度"；材料把胜负点立为**正确性量化 + 公平可复现对比 + 可视化**，而非"跑得比 Matlab 快"。
- `verify.py` 明确三种后端（本地 CPython+BLAS / Pyodide 单线程 / CPU 多线程）并用相对残差/相对误差口径，杜绝跨机硬比绝对值。

## 5. Pages / CI 保障

| ID | 约束 |
|---|---|
| F0 | 纯客户端 + Pyodide 可执行，无联网运行时 |
| F1 | `deploy.yml` 不拖红；新 E2E 在 Node 无 GPU 环境绿 |
| F2 | 所有 dot `bench/*.json` / `repro.json` 仓库内存档，评审可溯源 |

## 6. 里程碑（对齐提交节点）

| 期 | 交付 |
|---|---|
| 第 1 期 | P0.1–P0.3：网格 + 泊松/Helmholtz 求解 + 可视化骨架 |
| 第 2 期 | P0.4–P0.6：正确性对照 + 公平对比台 + 可视化界面完整 |
| 第 3 期 | P1.1–P1.4：解析预置库 + 多物理映射 + 报告/复现扩展 |
| 收尾 | `bench/em-pde-results.json` 成稿 + 材料逐条对照 |

## 7. 评审维度对照（商飞口径）

| 权重 | 对应实现 |
|---|---|
| 算法正确 25% | P0.2/P0.4 离散一致性 + 解析对照 + 收敛阶 + 真实残差认证 |
| 性能 20% | P0.5 公平对比（单/多线程 + 内存），诚实边界 §4 |
| 稳定性 15% | 复用 Result/错误注册表 + 故障覆盖 + MINRES/位移健壮 |
| 任务定义 15% | 泊松/Helmholtz/多物理 + 多轮网格，完整对齐题面六项 |
| 创新 15% | 浏览器零装 + WebGPU + 可复现 + 可视化侧写（复用底座注入） |
| 可复现 10% | P1.4 repro 全覆盖 + P1.3 离线报告 + 线程/内存口径 |

## 8. 回归验收（提交前勾）

- [ ] `npm run typecheck` + `vitest` 全绿；新 `python/tests` 覆盖网格/离散/对照/verify
- [ ] 泊松与 Helmholtz 各 ≥1 例解析对照误差随 n 递减（收敛阶合理）
- [ ] `bench/em-pde-results.json` 含正确性 + 性能 + 内存 + repro
- [ ] 插件在工作台可当场上手运行并导出离线报告/repro
- [ ] `deploy.yml` 绿，Pages 三端可访问
- [ ] 材料口径无"浏览器比 Matlab 快"式表述（按 §4）