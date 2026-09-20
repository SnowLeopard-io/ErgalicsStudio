# em_eigensolver — 大规模非正定厄密稀疏矩阵特征值求解器

面向**电磁谐振与微波器件仿真**的大规模稀疏厄密特征值问题 `A x = λ x` 求解方案（中国商飞赛题《面向电磁谐振与微波器件仿真的高效、稳定求解方案》，AI+工业软件赛道）。

FEM/MoM 离散后的算子 `A` 规模可达 **十万阶**，稀疏、厄密（实对称或复厄密），且因材料色散、PML 边界、高频/低频效应而**非正定**——目标频率对应的位移 `σ` 可能落在谱内部，`A − σI` 接近奇异。这正是本方案与常规"只处理正定矩阵"工具的差别所在。

本包既是 Ergalics Studio 插件 `src/plugins/builtin/em-eigensolver/` 的 Python 核心（浏览器内经 Pyodide 执行），也是可独立运行的本地 CLI。完整的算法推导与工程细节见仓库文档 `docs/technical/09-电磁谐振特征值求解器.md`。

## 快速开始

```bash
pip install -r requirements.txt            # numpy 必装；scipy 可选（缺失自动降级）

# 内置样例：零附近密集谱 + 近奇异位移 σ=0
python -m em_eigensolver.cli --sample cluster_zero --sigma 0 --k 8 --verbose --out eigen.npz

# 十万阶量级实证用例（n=102400, nnz=510720）
python -m em_eigensolver.cli --sample cavity_large --sigma 0.5 --k 6 --basis_dim 48 --out large.npz

# 求解自己的矩阵
python -m em_eigensolver.cli --input my_matrix.npz --sigma 1.25 --k 6

# 完整测试套件
python tests/test_all.py
```

- **输入**：`.npy`（稠密矩阵）、`.npz`（稠密数组或 SciPy 稀疏 CSR/CSC 归档）、`.mtx`（Matrix Market，支持 general / symmetric / hermitian / skew-symmetric / pattern / array）。
- **输出**：特征值与特征向量写入 `--out` 指定的 `.npz`（`numpy.load` 直接可读，`meta` 键内附 JSON 元数据）；标准输出给出后端、方法、位移、收敛状态、迭代数、matvec 数、最大相对残差、耗时与特征值列表。
- **退出码**：收敛 0；未收敛 1；配置或输入错误 2。
- **配置**：`--config` 加载完整 JSON 配置，全部字段与默认值见 `config.example.json`。

## 架构总览

| 模块 | 职责 |
| --- | --- |
| `backend.py` | 后端探测：有 SciPy 用 `scipy.sparse`，否则纯 NumPy CSR 降级 |
| `csr.py` | 降级模式使用的最小 CSR 实现 + 厄密性诊断 |
| `io_matrix.py` | 三种格式读取、三角恢复、厄密化、`write_eigen_npz` 结果写出 |
| `minres.py` | 厄密不定系统 MINRES 内层求解器（重启、真实残差守护、lucky breakdown 处理） |
| `lanczos.py` | 厚重启（Krylov-Schur / Wu & Simon）Lanczos：普通 + 位移逆，含**自适应位移** |
| `lobpcg.py` | 块 LOBPCG（`span{X, R, P}` 三块 Rayleigh-Ritz），天然处理重特征值 |
| `jacdavid.py` | Jacobi-Davidson：投影校正方程 + 收缩锁定（deflation） |
| `samples.py` | 参数化电磁仿真测试矩阵构造器（见"内置样例"） |
| `solver.py` | `SolverConfig` / `EigenResult` / `solve()` 门面：方法路由与收敛认证 |
| `driver.py` | 浏览器 Pyodide Worker 的 JSON 桥（`solve_json` / `export_npz`） |

## 方法路由（`method: "auto"`）

| 条件 | 内核 | 适用场景 |
| --- | --- | --- |
| 给定 `σ` | **Jacobi-Davidson** | 谱内目标 / 近奇异位移（迭代式位移逆退化时最稳） |
| 省略 `σ` | **Lanczos 普通** | 极端特征值（`which = LM/LA/SA`） |
| `lanczos` + `σ` | **位移逆 Lanczos** | 目标落在谱间隙内时最高效 |
| `lobpcg` | **块 LOBPCG** | 极端特征值 + 聚簇/重特征值 |
| `n ≤ dense_threshold`（默认 800） | 稠密 LAPACK 直解 | 仅当稠密特征分解比任何迭代路径更便宜且有界（见下） |

**关于"禁止稠密化"的合规说明**：`n × n` 算子在任何迭代路径中**从不形成、从不稠密化**；稠密特征分解只出现在两处受控位置——① `(m×m)` 投影矩阵（`m = basis_dim ≤ 200`，与 n 无关）；② `n ≤ dense_threshold` 的小规模直解，其 O(n²) 工作区有硬上界，且输入侧稠密通道另有 `max_dense_cells = 4×10⁶` 护栏（超限直接抛 `MatrixIOError`）。十万阶问题恒走稀疏 Krylov 路径。

## 核心算法原理

**位移逆谱变换**。给定目标 `σ`，内核作用于 `Op(q) = (A − σI)⁻¹ q`，Ritz 值映射回 `λ = σ + 1/θ`。内层系统厄密**不定**（CG 不适用），故用 MINRES。内层求解**有意不精确**（`rtol = 1e-6`）：外层 Rayleigh-Ritz 重正交化恢复全部精度，而近奇异的 `A − σI` 只需有界的内层迭代数。位移逆路径的有效外层容差为 `max(tol, 20 × minres_rtol)`。

**自适应位移**。当 `σ` 数值上恰好落在特征值上、`A − σI` 近奇异时，外层循环监测内层迭代速率（最近 16 次内层中超过 `near_singular_threshold = 120` 的比例），在周期边界自动把 `σ` 挪离奇点：固定方向（交替方向会振荡、比例步长在 `σ ≈ 0` 时退化）、步长倍增（`step = max(1e-3‖A‖, 1e-2|σ|)`）并重建 Krylov 基。每次移动记录在 `diagnostics.shift_history`。Jacobi-Davidson 不需要偏移——其校正方程的双斜投影把 `θ` 移出谱，近奇异时依然可解。

**重特征值与简并模式**。块 LOBPCG 的块形式让同一简并特征值的多个正交模式在一轮迭代中同时收敛；JD 的收缩锁要求**同时**满足特征值相对匹配（`|θ − λ_locked| ≤ 1e-9·max(scale, |θ|)`）与 Ritz 向量平行度 > 0.9——只用特征值判据会把重特征值的正交副本误判为"已找到"而丢失简并模式。

**收敛认证**。所有内核以真实残差 `‖Ay − λy‖ / max(|λ|, floor)` 判定收敛，结束后用全新的 matvec 重算认证——投影估计从不单独作为判据。`diagnostics` 报告迭代数、matvec 数、内层迭代总数、位移轨迹与内存估算（`memory_hint_mb`）。

**为什么不做内层预条件**。对不定算子，Jacobi 预条件 `M = diag(A)` 不正定（负内积产生 NaN）；对称对角缩放 `A' = PAP, P = diag(1/√|d|)` 在对角元趋零时灾难性恶化条件数（实测 400 次 MINRES 迭代不收敛，无预条件反而干净收敛）。故 MINRES 裸跑；对角良态的矩阵可在求解前显式变换。

## 复杂度与内存

每轮展开宽度 `m = basis_dim`（默认 48）的 Krylov 基：O(nnz) matvec + O(n·m) 正交化。唯一的稠密分解在 `(m×m)` 投影矩阵上。内存旋钮是 `basis_dim`（界面标注"基宽（内存档位）"）：同时决定基块内存、正交化开销与收敛速度；`memory_hint_mb` 与 `csr.py: sparse_memory_bytes()` 给出事前估算。CSR 构造路径只使用 O(nnz log nnz) 工作区；`NumpyCSR.dot()` 对多列右端项按列迭代（峰值 O(nnz + n·k)），不生成中间稠密矩阵。

## 并行与运行环境

纯 Python 内核受 NumPy/BLAS 性能支配：matvec 与小型 `eigh` 在本地自动派发到多线程 BLAS（`OMP_NUM_THREADS` / `MKL_NUM_THREADS`）。浏览器（Pyodide）构建按设计为单线程 WASM——求解主循环全程保持 CPU f64 精确路径（GPU SpMV 内核为平台级独立 API，不在求解热循环内），因此不存在"缺 GPU 时的降级"问题：**任何环境（本地 CPython / 浏览器）跑的都是同一套求解核心**，这本身就是赛题要求的最小化降级模式。

## 内置样例与基准数据

样例由 `samples.py` 构造器生成，全部按构造即厄密，参数显式（`n_cells, bandwidth, seed, …`），没有任何题面尺寸或答案写死。下表为默认参数实测值：

| 样例 | n | nnz | CSR 存储 | 推荐 σ | 推荐 k | 谱范围（实测） | 覆盖场景 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cavity_small` | 900 | 4380 | 0.06 MB | 0.6 | 6 | 0.5153 … 8.4847 | 小规模冒烟测试、低内存环境 |
| `cluster_zero` | 720 | 2148 | 0.03 MB | 0.0 | 8 | −0.2836 … 0.3040 | 零附近密集谱 + 近奇异位移 |
| `degenerate_pair` | 300 | 894 | 0.01 MB | −1.0 | 6 | −1.2511 … 2.2942 | 重特征值（收缩与块迭代） |
| `cavity_complex` | 576 | 2784 | 0.06 MB | 1.2 | 6 | 1.0282 … 8.9718（复厄密） | 复厄密算子 |
| `cavity_large` | 102400 | 510720 | 6.54 MB | 0.5 | 6 | 五点差分网格，理论 0 … 8 | 十万阶、控内存 |

- `cavity_*` 是二维五点差分网格 Laplacian 加确定性材料不均匀项；`cavity_complex` 给水平耦合加常数相位 `e^{iφ}`（保持厄密）。
- `cluster_zero` 由 6 个窄带三对角块拼装，实测 153 个特征值满足 `|λ| < 0.05`、35 个满足 `|λ| < 0.01`——默认 `σ = 0` 确实落在密集谱内部。
- `degenerate_pair` 的前两个三对角块完全相同，该带每个特征值恰好二重。
- 另有随仓库分发的 `examples/data/em-cavity-degenerate.mtx`（600×600，块对角重特征值结构，实测谱重数分布 2/4/20）。

## 故障场景与处置建议

| 症状 | 成因 | 处置 |
| --- | --- | --- |
| 内层 MINRES 达到 `maxiter` | `σ` 几乎正好是一个特征值 | 自适应位移自动介入；否则加大基宽或提高 `minres_maxiter` |
| 达到 `max_cycles` 仍未收敛 | 谱内密集簇而基宽不足 | 提高 `basis_dim`、放宽容差，或改用 Jacobi-Davidson |
| 选 `1e-12` 容差却停在约 `2e-5` | 位移逆 Lanczos 有效容差下限 `20 × minres_rtol` | 放宽预期或改用其他内核 |
| 随机稀疏矩阵上进展缓慢 | 随机矩阵谱近似 Wigner 半圆，谱内目标附近天然密集 | 问题本身性质而非缺陷；改用有物理结构的矩阵 |
| LOBPCG 下位移没生效 | 该内核只求极端特征值 | 需要谱内目标时改用 JD 或位移逆 Lanczos |
| 报告"结果包含非有限值" | 求解发散产生 NaN/Inf，驱动层已清洗为 null 并拒绝渲染 | 调整位移 σ 或容差后重试 |
| `MatrixIOError: unsupported extension` | 只接受 `.mtx / .npz / .npy` | 转换格式或改选内置样例 |
| 稠密文件被拒绝 | 超过 `max_dense_cells = 4×10⁶` | 改用稀疏 `.npz` 或 `.mtx` |

## 测试与可复现性

`python tests/test_all.py` 共 **22** 项测试（可独立运行或交给 pytest），覆盖：

| 测试 | 覆盖点 |
| --- | --- |
| `test_csr_matvec_and_hermiticity` | 纯 NumPy CSR matvec、厄密性度量、存储估算 |
| `test_numpy_csr_backend_matches_scipy` | 纯 NumPy 后端与 SciPy CSR 的 matvec / 索引 / 转置逐元素一致 |
| `test_hermiticity_measure_defaults` | 厄密性度量的默认参数与缺省路径 |
| `test_numpy_csr_parallel_matvec_matches_serial` | 行块多线程 matvec 与串行结果逐元素一致（含阈值路由） |
| `test_jd_inner_tolerance_is_relaxed` | JD 内层 `rtol / maxiter` 的门面收紧逻辑 |
| `test_driver_config_accepts_camel_case` | Worker 桥 camelCase / snake_case 双命名兼容 |
| `test_export_npz_contains_residuals` | 导出 `.npz` 含 `residuals` 键 |
| `test_mtx_npz_roundtrip` | `.mtx` 与稀疏 `.npz` 写读往返（误差 < 1e-12） |
| `test_hermitize_and_materialize` | 三角恢复与厄密化投影 |
| `test_minres_indefinite` | 不定系统 MINRES 收敛与真实残差 |
| `test_lanczos_plain_and_shift_invert` | 极端与位移逆两条路径，对照稠密 LAPACK |
| `test_lobpcg_extremal_and_repeated` | 重特征值块收敛、特征向量正交性 |
| `test_jacobi_davidson_dense_interior_and_deflation` | 谱内目标、简并模式收缩 |
| `test_samples_hermitian` | 各样例构造厄密性 |
| `test_solver_facade_all_methods` | 门面路由（含稠密兜底） |
| `test_cli_end_to_end` | CLI 端到端：写矩阵 → 求解 → 校验 `.npz` |
| `test_driver_solve_json_flat_payload` | Worker 桥扁平载荷约定（嵌套载荷显式失败） |
| `test_driver_mode_fields` | 模式场降采样（网格还原 / 近似布局 / 64 格上限 / 复数取模） |
| `test_nearest_grid_prime_falls_back` | 质数维度退化布局回退（两侧 ≥ 2 + 零填充） |
| `test_sanitize_json_replaces_nonfinite` | NaN/Inf → null 清洗 + 标志位（杜绝非法 JSON） |
| `test_parameter_sweep_curves` | 参数扫描曲线（`sweep.py`，扫描点间配置互不泄漏） |
| `test_validate_correctness_fast_subset` | 正确性验证 fast 子集（extremal 路径 + k 完整护栏） |

三个内核的数值结果均与稠密 LAPACK 参考比对，覆盖重特征值与谱内目标。**确定性**：所有随机初始化走 `np.random.default_rng(seed)`，`seed` 是界面参数与配置字段——同配置同种子结果可复现。完整套件为分钟到十数分钟量级（JD 与十万阶样例是主要耗时项），单项调试可用 `pytest -k <用例名>`。`benchmarks/` 目录另附性能基准（`perf_bench.py`）与正确性对抗基准（`validate_correctness.py`，13 用例含 8 组 adversarial 场景），实测结果 JSON 随仓库归档于 `bench/`。

最小复现环境：Python 3.10+（浏览器侧由 Pyodide 的 CPython 承担）、`numpy >= 1.24`（必装，BSD-3-Clause）、`scipy >= 1.10`（可选，BSD-3-Clause，缺失即纯 NumPy 后端）。

## 安全与合规设计

| 关注点 | 设计 |
| --- | --- |
| 禁止硬编码 / 不读取参考结果 / 不为公开用例调参 | 所有阈值（`tol`、`basis_dim`、`dense_threshold`、`near_singular_threshold`、`minres_rtol/maxiter`、块宽、种子）都是 `SolverConfig` 字段或内核参数；无任何参考答案表或按输入名称/规模分支的参数；收敛判定完全来自运行时真实残差 |
| 不得稠密化 | `dense_threshold` + `max_dense_cells = 4×10⁶` 双护栏；`n×n` 算子从不形成或稠密化（见"方法路由"） |
| 敏感信息保护 | 无网络上传路径：浏览器中矩阵只在独立 Worker 的解释器文件系统内解析计算，导出经本地文件下载；插件不采集、不回传任何矩阵内容或元数据 |
| 进程隔离与输入护栏 | 求解在专用 Worker 中执行，终止即整体重建；输入尺寸护栏在解析前生效，防恶意大文件耗尽内存 |
| 输入解析 | `.npy` 显式 `allow_pickle=False`；`.npz` 为兼容 SciPy 稀疏归档使用 `allow_pickle=True`，只应加载可信来源 |
| 依赖授权 | NumPy / SciPy（BSD-3-Clause）、Pyodide（MPL-2.0）、Three.js（MIT）；本包与插件均为 MIT |

## 与赛题要求的对应

| 赛题要求 | 对应实现 |
| --- | --- |
| a. 统一的读取/预处理/迭代/收敛/输出 | `io_matrix.py` → `solver.py` → 三内核 → `write_eigen_npz` / `driver.py`；CLI 与插件共用同一门面 |
| b. NumPy/SciPy 输入、稀疏存储、按需恢复三角/完整 | `.npy / .npz / .mtx` 全格式（本地另可直读 `.h5`/`.fits`/`.nc`，缺包时抛指名缺失包的 `MatrixIOError`）；`csr_from_coo(hermitian_fill=True)` 与 `materialize_triangle`，全程不经稠密 |
| c. 适配非正定/不定的 Krylov / 现代迭代算法 | 厚重启 Lanczos（Krylov-Schur）、块 LOBPCG、Jacobi-Davidson，核组件独立成文件可单独导入 |
| d. 位移策略（σ 近奇异）+ 自适应位移 | 位移逆变换 + 自适应 σ（内层速率触发、步长倍增、轨迹记录）；JD 投影校正天然规避近奇异 |
| e. 收敛控制与精度 | 全内核真实残差判据 + 事后认证；diagnostics 全量报告 |
| f. 内存峰值控制、避免稠密化 | `basis_dim` 内存旋钮、`memory_hint_mb`、双重护栏；BLAS 多线程 + 纯 NumPy 后端行块多线程 matvec（大矩阵 1.49×@1e5，见 benchmarks）；WebGPU SpMV 内核为宿主平台资产 |
| 可运行原型 | CLI + 插件图形界面，两条路径同一核心 |
| 样例数据与基准、默认配置 | 5 个参数化样例 + 1 个 `.mtx` 示例文件；`config.example.json` 完整配置 |
| 故障场景与验证 | 见"故障场景与处置建议"；测试覆盖重特征值、谱内目标、不定系统、退化布局、非有限值 |
| 可复现材料 | 源码、`requirements.txt`、本 README、22 项 Python 测试 + 30 项前端用例、`benchmarks/`（性能与正确性基准 + 实测结果 JSON）、同种子确定性 |

## 已知边界

| 项 | 现状 |
| --- | --- |
| 广义特征问题 | 仅支持 `A x = λ x`；`A x = λBx` 需使用者先变换（后续可在门面接受 `B`） |
| 内层预条件 | 默认不施加（理由见上文）；LOBPCG 保留钩子 |
| 并行与硬件加速 | BLAS 多线程 + 纯 NumPy 后端行块多线程 matvec（线程池仅在 n ≳ 4×10⁴ 启用，实测拐点）；无 MPI；浏览器内同步求解循环无法委派异步 WebGPU（GPU SpMV 内核为平台级独立 API，求解主循环保持 CPU f64 路径，Python 侧留有同步桥钩子） |
| 极端类型选择 | 插件固定 `which = 'LM'`；CLI 可传参 |
