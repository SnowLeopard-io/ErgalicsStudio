# em-eigensolver — 面向电磁谐振与微波器件仿真的非正定厄密特征值求解器

**赛题交付说明 | 插件 `example.em-eigensolver` v1.9.0**

对应赛题《面向电磁谐振与微波器件仿真的高效、稳定求解方案》（中国商飞 · AI+工业软件赛道）。
本文档为完整交付材料，覆盖：

1. **方案设计** —— 求解边界、架构、三大迭代内核、位移策略、收敛认证；
2. **非正定/不定厄密支持** —— 与"只处理正定矩阵"的工具的核心差别；
3. **样例数据与基准** —— 十万阶实测、5 个参数化样例、故障对抗用例；
4. **故障场景与验证** —— 低频击穿、重特征值、近奇异位移、内存受限的处置；
5. **复现说明** —— CLI / 浏览器插件 / 基准可在三环境中得到一致结果；
6. **与评审维度的对应** —— 逐条映射打分项。

详细推导与工程数据见仓库文档 [`docs/technical/09-电磁谐振特征值求解器.md`](../../../docs/technical/09-电磁谐振特征值求解器.md)。

---

## 1. 方案设计

### 1.1 求解边界与问题范围

FEM / MoM 离散后的电磁算子 `A` 规模可达**十万阶**，稀疏、厄密（实对称或复厄密），
且因材料色散、PML 边界、高频/低频效应而**非正定**。目标频率对应的位移 `σ` 常落在谱内部，
`A − σI` 接近奇异——这是本方案与常规"只处理正定矩阵"工具的核心差别。

| 边界项 | 设计取值 | 说明 |
| --- | --- | --- |
| 阶数 | `n ≤ 10⁵` 单机可控，已实测 `n = 102400` | 稀疏存 O(nnz)，内存旋钮 `basis_dim` |
| 谱型 | 厄密（实对称 / 复厄密），可非正定 / 不定 | MINRES 内层适用于不定系统 |
| 目标 | 极端特征值 或 `σ` 邻域谱内模式 | `method="auto"` 按是否有 `σ` 路由 |
| 输入 | `.npy / .npz`（含 SciPy 稀疏归档）/ `.mtx` | 统一读取 → 预处理 → 迭代 → 收敛 → 输出 |
| 约束 | 禁稠密化、禁硬编码、禁读参考结果 | 双护栏 + 纯运行时残差判定 |

### 1.2 架构（同一门面、两条路径）

遵循本项目插件契约，采用 **Python 数值内核 + TypeScript 前端** 分离架构，`solver.py`
的 `solve()` 是唯一门面：CLI 与浏览器 Pyodide Worker 跑**同一份代码**，结果可逐字节一致。

```
┌──────────────────────── 宿主工作台（TypeScript） ────────────────────────┐
│  plugin.ts 控制器/参数        render.ts 谱/残差/收敛三路可视化            │
│  em-client.ts  Worker RPC + 进度         diag-report.ts 自包含诊断 HTML  │
└─────────────────┬─────────────────────────────────────────────────────────┘
                  │ new Worker(em-worker.ts)   JSON payload
┌─────────────────▼─────────────────────────────────────────────────────────┐
│  Pyodide Worker（CPython 运行时）                                        │
│  driver.py  solve_json / export_npz / export_repro                       │
│     └── em_eigensolver：io_matrix → backend/csr → solver →               │
│         lanczos / lobpcg / jacdavid (+minres) → write_eigen_npz          │
└───────────────────────────────────────────────────────────────────────────┘
```

依赖最小化：`numpy`（必装，BSD-3-Clause）；`scipy` 可选，缺失自动降级到纯 NumPy CSR 后端。
`requirements.txt` 锁定版本下限（`numpy >= 1.24`、`scipy >= 1.10`）。

### 1.3 核心算法（三个现代迭代内核）

适配非正定/不定厄密的 Krylov 与现代迭代方法均以独立文件提供，可直接导入复用：

| 内核 | 文件 | 适用场景 |
| --- | --- | --- |
| **厚重启 Lanczos（Krylov–Schur）** | `lanczos.py` | 极端特征值；加位移逆 `(A−σI)⁻¹` 求谱内目标 |
| **块 LOBPCG** | `lobpcg.py` | 极端 + 聚簇 / **重特征值**（块形式） |
| **Jacobi-Davidson** | `jacdavid.py` | **谱内目标**（`σ` 邻域）/ 近奇异位移（投影校正天然规避） |

- **方法路由**：`method="auto"` 有 `σ` → JD；无 `σ` → Lanczos 普通；`lobpcg` → 块迭代；
  `lanczos` + `σ` → 位移逆 Lanczos。
- **内层不定系统**：位移逆与 JD 校正方程都是厄密**不定**系统，共轭梯度不适用，
  统一用 `minres.py`（MINRES，真实残差守护、lucky breakdown 处理）。
  JD 内层容差恒不严于 `1e-4`（`max(minres_rtol, 1e-4)`），只需下降方向。
- **位移策略与自适应位移**：位移逆变换把 Ritz 值映射回 `λ = σ + 1/θ`；当 `σ` 数值上
  落在特征值上导致 `A−σI` 近奇异时，外层监测内层迭代速率，按固定方向、步长倍增自动
  把 `σ` 挪离奇点（轨迹记录在 `diagnostics.shift_history`）。JD 不依赖位移逃离。

### 1.4 收敛认证与统一口径

所有内核以**真实残差** `‖Ay − λy‖ / max(|λ|, floor)` 判定收敛，结束后用全新 matvec
重算认证；投影估计从不单独作为判据。`diagnostics` 报告迭代数、matvec 数、内层迭代
总数、位移轨迹与内存估算。

> **容差口径**：位移逆路径有效外层容差放宽为 `max(tol, 20 × minres_rtol)`（默认内层
> `1e-6`，即下限 `2×10⁻⁵`），按**相对残差**判定。基准 JSON 分别归档
> `tol_requested / tol_effective / certified_rel_residual`，绝不混同。

### 1.5 合规与安全设计

| 关注点 | 实现 |
| --- | --- |
| 禁止硬编码 / 不读参考结果 | 所有阈值都是 `SolverConfig` 字段或内核参数；无参考答案表、无按输入名称/规模分支 |
| 禁止稠密化 | `dense_threshold + max_dense_cells = 4×10⁶` 双护栏；`n×n` 算子从不形成或稠密化 |
| 敏感信息保护 | 无网络上传；矩阵仅在独立 Worker 文件系统内解析，导出走本地下载 |
| 输入护栏 | 尺寸护栏在解析前生效；`.npy` 显式 `allow_pickle=False` |

---

## 2. 矩阵读取与预处理

`io_matrix.py` 统一组织读取、预处理、三角恢复与结果写出：

- **输入**：`.mtx`（Matrix Market，general/symmetric/hermitian/…）、`.npz`
  （稠密数组或 SciPy 稀疏 CSR/CSC 归档）、`.npy`（稠密，带 `max_dense_cells` 护栏）。
- **三角恢复**：`materialize_triangle()` 用 CSR 逐行构造下三角/完整矩阵，**不经稠密**。
- **厄密化投影**：`hermitize()` 把读取矩阵投影到最近的厄密矩阵（O(nnz)）。
- **输出**：`write_eigen_npz()` 写出 `numpy.load` 直接可读的 `.npz`
  （`eigenvalues + eigenvectors + residuals + meta`）。

---

## 3. 样例数据与基准

`python/samples.py` 提供 **5 个参数化样例**（全部按构造即厄密、参数显式、无题面尺寸写死）：

| 样例 | n | 关键特征 | 覆盖场景 |
| --- | --- | --- | --- |
| `cavity_small` | 900 | 谱 0.52 … 8.48 | 冒烟测试、低内存 |
| `cluster_zero` | 720 | 153 个特征值 `|λ|<0.05` | 零附近密集谱 + 近奇异位移（低频击穿） |
| `degenerate_pair` | 300 | 前两块完全相同 | 重特征值（收缩与块迭代） |
| `cavity_complex` | 576 | 复厄密 | 复厄密算子 |
| `cavity_large` | **102400** | nnz=510720，6.54 MB | 十万阶、控内存 |

另有随仓库分发的 `examples/data/em-cavity-degenerate.mtx`（600×600 块对角重特征值结构，
实测谱重数分布 2/4/20）与 `python/config.example.json` 完整默认配置。

**基准数据**（`bench/`，实测归档）：`em-eigensolver-results.json`（性能）、
`em-eigensolver-validate.json`（13 用例含 8 组对抗）、`em-eigensolver-stress.json`（压力）。
三个内核均与稠密 LAPACK（`numpy.linalg.eigh`）参考比对。

---

## 4. 故障场景与验证

`python/benchmarks/validate_correctness.py` 的 `stress_cases()` 覆盖赛题点名的典型场景：

| 场景 | 覆盖 | 处置 |
| --- | --- | --- |
| 零附近密集谱 / 低频击穿 | `cluster_zero`，153 个特征值落 `|λ|<0.05` | `auto` 路由 JM 谱内目标；否则基宽自适应 |
| 重特征值 | `degenerate_pair`、`.mtx` 600 阶 | LOBPCG 块形式 / JD 收敛锁定（特征值匹配 + 平行度双判据） |
| 近奇异位移（目标频率贴近谐振点） | `σ` 落在特征值上 | JD 投影校正不依赖位移逃离；位移逆触发自适应位移 |
| 内存受限 | `cavity_large` 十万阶 + `memory_hint_mb` | `basis_dim` 内存旋钮，CSR 只占 O(nnz) |
| 病态缩放 | `1e9 / 1e-9` scaling 用例 | 显式对称预缩放路径 |

每类均给出精度、性能、迭代次数与处置建议；见技术文档"故障场景与处置建议"表。

---

## 5. 资源与性能（十万阶实测）

- **避免稠密化**：纯 NumPy CSR 后端 `csr.py::dot()` 对多列右端项按列迭代，峰值
  O(nnz + n·k)，不生成中间稠密矩阵；`basis_dim` 同时是基块内存与收敛速度旋钮。
- **多线程**：BLAS 多线程（`OMP_NUM_THREADS`）+ 纯 NumPy 后端行块
  ThreadPoolExecutor matvec（线程池仅 n ≳ 4×10⁴ 启用；实测 102400 行 ~1.49x）。
- **十万阶实证**：`cavity_large`（n=102400）默认配置极值路径约 15 s 收敛，内层最小
  迭代 3.6e-9；σ 邻域对照行绝对残差 5.9e-05 ↔ 相对 7.4e-06 ≤ 有效容差 2×10⁻⁵。
- 浏览器 / 本地 CPython 跑同一 CPU f64 求解核心，天然满足赛题"缺 GPU 的最小化降级模式"。

---

## 6. 复现说明

### 6.1 前置条件

```
Python 3.10+           （本机已用 CPython 验证）
pip install -r python/requirements.txt   # numpy 必装；scipy 可选
Node 18+ / npm         （前端 typecheck / 构建）
```

### 6.2 方式一：CLI（推荐）

```bash
cd src/plugins/builtin/em-eigensolver/python

# 零附近密集谱 + 近奇异位移（低频击穿场景）
python -m em_eigensolver.cli --sample cluster_zero --sigma 0 --k 8 --verbose --out eigen.npz

# 十万阶量级实证（n=102400）
python -m em_eigensolver.cli --sample cavity_large --sigma 0.5 --k 6 --basis_dim 48 --out large.npz

# 求解自己的矩阵（npz/mtx/npy 均可）并导出复现凭证
python -m em_eigensolver.cli --input my_matrix.npz --sigma 1.25 --k 6 --out eigen.npz --repro repro.json

# 完整测试套件（26 项，无 pytest 依赖）
python tests/test_all.py

# 性能 / 正确性对抗基准 → bench/ JSON
python benchmarks/perf_bench.py
python benchmarks/validate_correctness.py
```

退出码：收敛 0 / 未收敛 1 / 配置或输入错误 2。`--repro` 写 `repro.json`
（`ergalics.em-repro` v1：矩阵 SHA-256 指纹 + 参数哈希 + 种子 + 代码快照 + 结果摘要）。

### 6.3 方式二：浏览器插件（工作台）

1. `npm install`
2. `npm run dev` 启动工作台；
3. 在"内置示例"面板打开 **电磁谐振特征值求解器（em-eigensolver）**；
4. 加载样例 / 上传 `.mtx|.npz|.npy`，设置 `σ`、`k`、`basisDim`，点击求解；
5. Canvas 三路可视化：特征值谱、残差条形图（log 刻度 + 容差线）、收敛轨迹；
6. 可导出 `.npz` 结果 / `repro.json` 复现凭证 / 自包含 HTML 诊断报告。

> 浏览器与 CLI 结果一致，因其共用 `solver.py` 的 `solve()` 门面。

### 6.4 方式三：前端单测 + 基准回归

```bash
npm test                                  # vitest run（含 em-eigensolver 35 项前端用例）
npm run build:web                          # tsc --noEmit && vite build
```

---

## 7. 与评审维度的对应

| 评审维度（权重） | 对应内容 |
| --- | --- |
| **任务定义与通用性（15%）** | §1.1 求解边界明确（十万阶、非正定、σ 近奇异）；`numpy/scipy` 格式 + 稀疏存储 + 按需三角恢复（§2） |
| **算法正确性与精度（25%）** | 三内核均以真实残差判据收敛、结束后重新认证（§1.4）；与稠密 LAPACK 参考比对；重特征值/谱内目标/不定系统均通过测试 |
| **性能与资源效率（20%）** | 十万阶实测（§5）；避免稠密化、`basis_dim` 内存旋钮、多线程 matvec；基准 JSON 归档 |
| **稳定性与鲁棒性（15%）** | 近奇异位移（自适应位移 / JD 投影校正）、零附近密集谱、重特征值、内存受限全覆盖（§4） |
| **创新性与工程落地（15%）** | 自适应位移 + 不精确内层 + 双判据收缩锁定；统一门面 CLI/浏览器双路径；混精度 GPU 与原生 sidecar 路线图（§8） |
| **可复现性与文档（10%）** | 26 项 Python + 35 项前端测试；同种子确定性；`repro.json` 复现凭证；本交付文档 + 技术文档 09 + `python/README.md` |

---

## 8. 已知边界与路线图

| 项 | 现状 | 建议方向 |
| --- | --- | --- |
| 广义特征问题 | 仅 `Ax=λx` | 后续门面接受 `B`（质量矩阵）并改 `B` 内积 |
| 并行与硬件加速 | BLAS 多线程 + 行块多线程；无 MPI；GPU SpMV 内核为平台级独立 API | 见下方 Roadmap |
| 一万阶以上大批量性能 | WASM 单线程是天花板 | 见下方 Roadmap |

**性能与扩展 Roadmap**：① **混精度 GPU 加速**——把 `csr` 已实现的 WebGPU f32 SpMV
经同步宿主桥 `csr.set_gpu_spmv` 接入，配合 CPU f64 残差复核，保持认证精度的同时摊薄
十万阶 matvec 成本；② **原生 sidecar**——经 WASIX / 原生 Node 扩展把稀疏路径放到多核
原生 CPython/OpenMP，绕开 WASM 单线程；③ **MPI 分布式**——内核已与后端解耦，块 Krylov
可按进程分片平移；④ **位移相关 SPD 预条件**——在可判定为正定的位移区间内层启用预条件。

---

## 9. 交付清单

| 文件 | 说明 |
| --- | --- |
| `python/em_eigensolver/*.py` | 数值内核（io_matrix/backend/csr/minres/lanczos/lobpcg/jacdavid/samples/solver/sweep/repro/driver/cli） |
| `python/tests/test_all.py` | 26 项断言测试运行器 |
| `python/benchmarks/perf_bench.py` | 性能基准（SpMV 标度 + 十万阶） |
| `python/benchmarks/validate_correctness.py` | 正确性 + 8 组对抗用例 + 压力场景 |
| `python/config.example.json` | 完整默认配置样例 |
| `python/README.md` / `requirements.txt` | 内核用法说明 / 依赖清单 |
| `em-worker.ts` / `em-client.ts` / `plugin.ts` | 前端 Worker / RPC / 控制器 |
| `render.ts` / `render3d.ts` / `diag-report.ts` / `types.ts` | 谱/残差/收敛可视化、3D 模式场、诊断报告、协议类型 |
| `manifest.ts` / `index.ts` | 插件清单与注册 |
| `../../../docs/technical/09-电磁谐振特征值求解器.md` | 技术文档（算法/复杂度/基准/故障/安全/赛题映射） |
| `examples/data/em-cavity-degenerate.mtx` | 600 阶重特征值样例矩阵 |
| `bench/em-eigensolver-*.json` | 已生成基准结果 |
| `tests/emEigensolver.test.ts` | 前端纯函数单测（35 项用例一部分） |
| `src/plugins/builtin/index.ts` | 已注册进内置插件列表 |
| 本文件 `SOLUTION.md` | 赛题交付说明 |