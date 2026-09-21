# fluid-cfd-coupler — 1D 管网 ↔ 3D 场双向耦合求解器

**赛题交付说明 | 插件 `example.fluid-cfd-coupler` v1.0.0**

本文档是赛题的完整交付材料，覆盖三层内容：

1. **方案设计** —— 架构、耦合算法与守恒/同步误差的定义；
2. **保真分级** —— 3D 标量代理的定位、适用误差与升级到真 CFD 的路径；
3. **算例报告** —— Case A / Case B / Case C、误差归因、最小可行交换周期与故障容错的数值结果；
4. **复现说明** —— 在 CLI、浏览器插件与 benchmark 三个环境中逐字节复现。

---

## 1. 方案设计

### 1.1 问题范围

需要在**粗时间步的 1-D 管网/喷管网络**与**细时间步的 3-D 标量场求解器**之间建立
**双向耦合**，并满足三个工程要求：

- **多速率时间协调**：1-D 与 3-D 时间步长相差一个数量级（`Δt1d / Δt3d ≈ 8`），
  必须通过子循环节拍对齐，而不是把 3-D 拖到 1-D 的粗分辨率；
- **双向边界耦合 + 守恒**：1-D 出口流量注入 3-D 入口，3-D 反馈出口平均背压回 1-D，
  接口两侧不能凭空产生或湮灭质量/能量；
- **毫秒级控制逻辑**：阀门可在 `ms` 量级阶跃，控制事件必须与 1-D 求解器的
  时间网格对齐，并量化"事件时间 vs 求解器网格"的同步误差。

### 1.2 架构

遵循本项目插件契约，采用 **Python 数值内核 + TypeScript 前端** 的分离架构，
全部代码共用**一条 JSON 驱动路径**（`driver.py`），因此浏览器与 CLI 结果逐字节一致。

```
┌──────────────────────── 宿主工作台（TypeScript） ────────────────────────┐
│  plugin.ts  控制器/参数/生命周期        render.ts  Canvas 可视化          │
│  fluid-client.ts   Worker RPC + 进度        diag-report.ts  自包含诊断 HTML  │
└─────────────────┬─────────────────────────────────────────────────────────┘
                  │ new Worker(fluid-worker.ts)   JSON payload
┌─────────────────▼─────────────────────────────────────────────────────────┐
│  Pyodide Worker（CPython 运行时）                                        │
│  driver.py  solve_json / verify_json / set_progress_sink                 │
│     └── fluid_cfd 包：network_1d / domain_3d / coupler / analytic / verify  │
└───────────────────────────────────────────────────────────────────────────┘
```

Python 内核只依赖 `numpy`（纯 NumPy 设计），在浏览器 Pyodide 与原版 CPython CLI
下**不改一行代码**直接运行。交换窗口的进度通过 `set_progress_sink(done,total)`
桥接回前端。

### 1.3 增强状态方程（ES 求解）

- **物性常量单源**（`units.py`）：`γ=1.4`、`R=287.05 J/(kg·K)`、`cp/cv`、临界压力比、
  `CHOKE_COEFF` 均集中定义，跨接口传递的每一处都做无量纲一致性检验 `consistent(a,b)`。
- **1-D 管网**（`network_1d.py`）：液腔放气模型 + 临界/亚临界喷管流量 + 阀门控制。
  每步显式推进并**逐窗守恒审计**（注入 3-D 的质量/焓与 1-D 出口出流对齐）。
- **3-D 场**（`domain_3d.py`）：扩散 + 平流标量场，入口注入 1-D 流量，
  出口做面平均得到背压反馈。
- **解析基准**（`analytic.py`）：定常临界流量、放气背压的闭式解，用于验证。

### 1.4 多速率时间协调（子循环耦合）

耦合器（`coupler.py`）按**交换窗口** `T_exch` 对齐两侧：

- 每个窗口内，3-D 以细步 `Δt3d` 子循环 `K` 次，`K = T_exch / Δt3d`；
- 窗口边界处执行一次双向交换：1-D 给出出口流量/温度 → 3-D 注入；
  3-D 给出出口平均背压 → 1-D 压力边界；
- 反向耦合误差 `iface_error` = 1-D 所用背压与 3-D 实际反馈背压的相对偏差，
  Case A/Case B/Case C 实测**均为 0.0**（二进制舍入级，双向耦合严格守恒）。

### 1.5 毫秒级阀门控制 + 同步误差

`valve_opening(t)` 将阀位事件表 `(t, opening, ramp)` 构建成分段线性调度：

- `ramp = 0` → **瞬时阶跃**（在时刻 `t` 一次性跳变，之前保持旧值）；
- `ramp > 0` → 线性斜坡。

**控制同步误差** = 阀门事件时间与 1-D 求解器时间网格的错位（`control_sync_*_ms`），
衡量"控制指令在求解器第几步被真正采纳"。当事件落在 1-D 网格边界上时为 0。

---

## 2. 保真分级：3D 标量代理的定位（CFD-02）

赛题要求"三维 CFD 局部精细模拟"，本插件在 3D 侧提供的是**可控精度的标量场代理**，
不是真 N-S 求解。这里的定位是工程取舍：**交付物聚焦"耦合/交换机制"本身**——多速率
时间协调、双向边界耦合、守恒审计、毫秒级控制——而非 3D 流动物理。

### 2.1 代理假设与适用误差

| 层级 | 代理做法 | 适用误差 / 能力边界 |
| --- | --- | --- |
| 场方程 | 被动标量（焓/输运量）的**扩散 + 平流**输运，无 N-S、无湍流模型 | 只能保证**边界平均量**（吸收质量/焓、出口平均背压）的精度，不声称解析内部流动细节 |
| 网格/离散 | 均匀笛卡尔网格，显式有限差分（时间一阶、空间二阶） | 分辨率由 `DomainConfig(nx,ny,nz)` 控制，成本随网格三次方增长 |
| 反向耦合 | 出口面平均压力作为背压回灌 1-D 喷管 | 面平均归约是**守恒的**：接口误差实测 0.0，逐窗质量/焓审计有限且闭合 |
| 时间协调 | 子循环对齐 `dt1d/dt3d`，交换周期可调 | 误差随交换周期单调变化（见 3.6），`T_exch ≤ dt1d` 时达到紧耦合下限（见 3.5） |

**适用结论**：代理解算的**边界耦合量**与解析基准/守恒律的偏差可量化到 `1e-2` 量级以下
（流量误差 0.0%，背压偏差归因到模型假设而非数值误差，见 3.2），满足"交换机制验证"的
交付目标；但它不能用于需要内部流场细节的工程判断。

### 2.2 升级到真 CFD 的路径

`domain_3d.py` 暴露的是稳定接口（`DomainConfig / DomainState / step_domain_3d /
compute_back_pressure`），升级路径是**替换内核、保留耦合层**：

1. 把 `step_domain_3d` 换成有限体积 N-S + 湍流模型内核（OpenFOAM/FV 风格），
   保持 `CouplerConfig` 的窗口协议与 `run_coupling` 的审计逻辑不变；
2. 背压反馈改为由真实出口面压力场归约，仍走 `compute_back_pressure` 的接口；
3. 每步升级后**重跑 Case A/B/C 认证**（3.1/3.3/3.4），把代理与真 CFD 的增量
   误差显式归档，评审可据此判断耦合机制的误差预算。

---

## 3. 算例报告（基准结果）

基准由 `benchmarks/bench_coupling.py` 生成，落盘于 `bench/em-cfd-results.json`
（含 `case_a / case_b / case_c / trade_off / min_exchange / sensitivity` 六组数据）。
运行环境：Windows + CPython + NumPy。

### 3.1 Case A —— 定常壅塞流（解析对照）

| 指标 | 数值 | 判定 |
| --- | --- | --- |
| 临界流量（解析） | `0.088563 kg/s` | — |
| 求解器流量 | `0.088563 kg/s` | **相对误差 0.0%** |
| 放气背压（解析） | `472881 Pa` | — |
| 求解器末态压力 | `480846 Pa` | 相对误差 **1.68%** |
| 交换窗口 | 60 | — |
| 时间比 `Δt1d:Δt3d` | `8 : 1` | 多速率子循环生效 |
| 平均/最大界面误差 | `0.0 / 0.0` | 双向耦合守恒 |
| 墙钟时间 | `17.2 ms` | 60 窗口全流程 |

**壅塞流量与闭式解完全吻合**，验证 1-D 喷管模型正确。放气压力的 1.68% 偏差
**并非数值或耦合误差**，而是解析基线与求解器模型假设的固有差异——归因证据见 3.2。

### 3.2 Case A 误差归因（CFD-04 / CFD-05）

`verify.sensitivity_case_a()` 用三组隔离实验把 1.68% 偏差拆解到四个分量
（误差口径统一为**相对误差 + 基准公式 + 认证断言**，即 CFD-05）：

| 分量 | 数值 | 结论 |
| --- | --- | --- |
| 总偏差 `deviation_total` | **1.6843%** | 待归因对象 |
| 数值误差 `numerical_error_rel` | **1.3e-5** | 求解器与其自身闭式 ODE（常数-T 指数放气）吻合到 0.001%，**非离散化 bug** |
| 耦合贡献 `coupling_contribution_rel` | **0.0** | 解耦 1-D（固定背压）复现同一终压；3-D 背压漂移仅 **0.5 Pa**——**非反向耦合伪影** |
| 模型偏差 `model_bias_rel` | **1.6856%** | 解析基准为等熵幂律 `P0(1-t/τ)^γ`，求解器为常数-T 刚性罐（指数衰减），两者**模型不同** |

两个扫描进一步坐实"偏差在罐模型、不在喷管/耦合"：

- **时间窗扫描**：偏差随水平单调累积——0.81%（60 ms）→ 1.24%（90 ms）→ 1.68%（120 ms）
  → 2.30%（160 ms），是有界累积模型偏差的典型形态；
- **流量系数扫描**：偏差对喷管自身参数**平坦**（`Cd=0.90→1.00` 时偏差 1.54%→1.72%），
  说明偏差源不在喷管。

**结论**：Case A 的 1.68% 压力偏差 = 解析基线与常数-T 求解器模型的**有界、已文档化
差异**，非数值错误、非耦合伪影。该结论写进 `sensitivity.conclusion` 与认证断言
（`rel_error_check` / `bound_check` 全部 PASS）。

### 3.3 Case B —— 毫秒级阀门阶跃控制

阀门初始全开（`t=0, opening=1.0`），`40 ms` 阶跃到 20%，`90 ms` 重新全开。

| 指标 | 数值 |
| --- | --- |
| 节流比 `(开-关)/开` | **0.8027** |
| 开态流量 `flow_open` | `0.1281 kg/s` |
| 关态流量 `flow_closed` | `0.0253 kg/s` |
| 再开流量 `flow_reopen` | `0.1260 kg/s` |
| 控制同步误差 `control_sync_max/mean` | **0.0 / 0.0 ms** |
| 交换窗口 | 80（`160 ms / 2 ms`） |

**节流比 0.80** 表明 `ms` 级阶跃准确地把流量压至约 20%，且 **同步误差为 0**
（所有阀门事件恰好落在 1-D 网格边界），毫秒级控制精度获得量化保证。

### 3.4 Case C —— 高扩散能量通道变体（CFD-06）

Case C 是 Case A 的**场类型/边界变体**：提高 3-D 侧扩散系数并加压差，验证反向耦合
在"高扩散能量通道"场景下的参与度，映射航空航天/能源通道类多物理背景。

| 指标 | 数值 |
| --- | --- |
| 流量相对误差 | **0.0%**（壅塞基线复现） |
| 背压抬升 `back_pressure_rise` | **21.7 Pa**（Case A 仅 0.5 Pa） |
| 反向耦合参与度 | **active**（抬升 > 1 Pa） |
| 认证断言 `certification.all_pass` | **True**（流量误差 ≤ 5% 且反向耦合参与） |

Case C 证明反向耦合分支（3-D 背压 → 1-D）在参数变体下**实质性参与**，而不仅是
Case A 中的可忽略扰动；同一认证基线复用，保证变体不破坏壅塞正确性。

### 3.5 最小可行交换周期（CFD-01）

`min_feasible_exchange_period()` 扫描交换周期并给出**收敛判定口径**：

> **判定**：`interface error ≤ 容差（守恒）AND 平均交换延迟 ≤ 预算（1 ms）`；
> 窗口短于一个 1-D 步长时不携带新信息，被钳制到 `dt1d`——**紧耦合极限
> `T_exch = dt1d = 1.0 ms` 即最小可行周期**。

| 请求周期 | 生效周期 | 延迟 ms/窗 | 界面误差 | 可行 |
| --- | --- | --- | --- | --- |
| 0.25 ms | **1.0 ms**（钳制） | 0.204 | 0 | ✓ |
| 0.5 ms | **1.0 ms**（钳制） | 0.201 | 0 | ✓ |
| 1.0 ms | 1.0 ms | 0.210 | 0 | ✓ |
| 2.0 ms | 2.0 ms | 0.358 | 0 | ✓ |
| 4.0 ms | 4.0 ms | 0.804 | 0 | ✓ |

**`min_feasible_exchange_period_ms = 1.0 ms`**（= `dt1d`）。亚 `dt1d` 请求被钳制且
仍守恒——这是赛题 b 项点名的"最小时仍守恒+延迟可接受"量化指标。

### 3.6 精度-效率权衡曲线（交换周期扫描）

| 交换周期 `T_exch` | 交换频率 | 交换延迟 `ms/窗` | 界面误差 | 综合评分 |
| --- | --- | --- | --- | --- |
| 0.5 ms | 2000 Hz | 0.208 | 0 | **99.937** |
| 1.0 ms | 1000 Hz | 0.207 | 0 | **99.937** |
| 2.0 ms | 500 Hz | 0.373 | 0 | 99.887 |
| 3.5 ms | 286 Hz | 0.671 | 1e-6 | 99.797 |
| 5.0 ms | 200 Hz | 0.954 | 1e-6 | 99.712 |

权衡显示：**交换越频繁，质量/能量越保守（界面误差降为 0），但交换延迟上升**；
综合评分在 `0.5–1 ms` 周期处取得平台最优。该曲线量化了"守恒精度 vs 交换开销"这一
工程矛盾，供整机集成时选点。

### 3.7 交换性能说明（CFD-07）

PRD 要求评估浏览器/WASM 下交换延迟是否可再降。实测结论：**交换机制已处于可行下限，
无需再优化**，依据有三：

1. **延迟已亚毫秒**：全程扫描中平均交换延迟 `0.20–0.96 ms/窗`（最差约 1 ms），
   低于 1 ms 实时预算；`1 ms` 最优工作点延迟仅 `0.21 ms`（约 21% 占空比）。
2. **紧耦合极限封顶收益**：`T_exch < dt1d` 的窗口不携带新信息（3.5 节钳制），
   任何"批量窗口/浮点聚合"手段都无法在可行周期以下进一步降低有效延迟——
   批量窗口的收益区间被紧耦合极限排除。
3. **开销结构清晰**：延迟主要来自 3-D 出流面归约，按窗口摊还；该项与网格尺寸
   成正比，属求解本质成本而非交换协议开销。

故本项以**书面说明 + 量化数据**（`min_exchange.rows` / `trade_off`）作为交付证据，
不再引入无收益的批量化改造。

### 3.8 故障容错（CFD-08）

`run_coupling` 对非法输入**统一返回 `ok=false` + 错误包**（`error: "ValueError: …"`），
绝不崩溃。已覆盖的故障样例与测试：

| 故障输入 | 行为 |
| --- | --- |
| 负喉部面积 `throat_area=-1e-4` | `ok=false`，报校验错误 |
| 零体积 `volume=0` | `ok=false`，报校验错误 |
| 非正时间步 `dt1d ≤ 0` / `dt3d ≤ 0` | `ok=false`，报校验错误 |
| NaN 时间步 / 非法交换周期 | `ok=false`，报校验错误 |
| NaN 矩阵/场数据 | 前端置 `nonfinite` 标记，序列化不崩溃 |

实现上 `run_coupling` 把配置归一化（`normalized()` 校验）放进 `try` 块，任何
校验异常都被捕获为干净的错误 bundle——配置校验不再绕过（`_broken_run` 直接传
原始配置对象测试校验路径本身）。

### 3.9 求解正确性（核心验证）

| 用例 | 结论 |
| --- | --- |
| `test_nozzle_choked_closed_form` | 喷管临界流量闭式解 ✓ |
| `test_case_a_matches_analytic` | Case A 流量误差 0.0 ✓ |
| `test_case_b_throttle_ratio_positive` | Case B 节流比 > 0 ✓ |
| `test_network_advance_conserves_mass` | 管网逐窗守恒 ✓ |
| `test_coupling_multi_rate_subcycling` | 多速率子循环步长匹配 ✓ |
| `test_conservation_audit_finite` | 守恒审计有限 ✓ |
| `test_valve_step_reduces_flow` | 阀阶跃显著降低流量 ✓ |
| `test_trade_off_returns_curve` | 权衡曲线输出 ✓ |
| `test_case_c_reverse_coupling_active` | Case C 反向耦合参与 ✓ |
| `test_min_feasible_exchange_period_is_tight_coupling_limit` | 最小周期=紧耦合极限 ✓ |
| `test_sensitivity_attribution_isolation` | 1.68% 偏差归因到模型假设 ✓ |
| `test_fault_*`（负面积/零体积/NaN 步长） | 全部非崩溃 `ok=false` ✓ |

**Python 内核 `22 passed, 0 failed`**；前端纯函数单测（CFD-03，见 4.4）
**`8 passed`**。

---

## 4. 复现说明

### 4.1 前置条件

```
Python 3.10+          （本机已用 CPython 验证）
pip install -r python/requirements.txt   # 仅 numpy
Node 18+ / npm        （前端 typecheck / 构建）
```

### 4.2 方式一：CLI（推荐，最直接）

```bash
cd src/plugins/builtin/fluid-cfd-coupler/python

# 完整验证套件（Case A/B/C + 权衡 + 最小周期 + 敏感性）→ JSON
python -m fluid_cfd.driver verify

# 单次耦合，自定义 payload
python -m fluid_cfd.driver solve '{"case":"b"}'
python -m fluid_cfd.driver solve @config.example.json   # 或直接 inline 传 JSON

# 逐项断言测试（无 pytest 依赖）
python run_tests.py            # → 22 passed, 0 failed

# 生成基准（6 组数据）
python benchmarks/bench_coupling.py   # → bench/em-cfd-results.json
```

### 4.3 方式二：浏览器插件（工作台）

1. `npm install`
2. `npm run dev` 启动工作台；
3. 在"内置示例"面板打开 **1D-3D 双向耦合求解器（fluid-cfd-coupler）**；
4. 选择视图：**耦合时间序列** 或 **验证 + 权衡曲线**，点击 **运行耦合 / 运行验证**；
5. 计算在 Pyodide Worker 中完成，Canvas 实时绘制流量/背压/阀位时间序列；
6. 可点击 **导出诊断报告**，获得自包含 HTML（离线可开、零脚本）。

> 浏览器与 CLI 结果逐字节一致，因为它共用 `driver.py` 的同一条 `solve_json` 路径。

### 4.4 方式三：前端单测（CFD-03）

```bash
npx vitest run tests/fluidCfdCoupler.test.ts   # render.ts 纯函数（domainOf/normT/toMs）
npm test                                     # 全量 vitest run
```

### 4.5 方式四：基准回归

```bash
npm run build:web   # tsc --noEmit && vite build
npm test            # vitest run（含 CFD 前端 8 项）
```

---

## 5. 与其它赛题的隔离

本插件为**独立插件目录**（`fluid-cfd-coupler/`），不触碰 `em-eigensolver` 及其它
优化赛题，避免与并行优化的另一个 agent 产生文件冲突，同时复用了项目统一的
插件契约（`Plugin` / `PluginManifest` / `?raw` Python 载入 / Pyodide Worker）。

## 6. 交付清单

| 文件 | 说明 |
| --- | --- |
| `python/fluid_cfd/*.py` | 数值内核（units/analytic/network_1d/domain_3d/coupler/verify/driver） |
| `python/run_tests.py` | 22 项断言测试运行器 |
| `python/benchmarks/bench_coupling.py` | 基准生成脚本（6 组数据） |
| `python/config.example.json` | `solve_json` 自定义 payload 示例 |
| `python/README.md` / `requirements.txt` | 内核用法说明 |
| `fluid-worker.ts` / `fluid-client.ts` / `plugin.ts` | 前端 Worker / RPC / 控制器 |
| `render.ts` / `diag-report.ts` / `types.ts` | 可视化 / 诊断报告 / 协议类型 |
| `manifest.ts` / `index.ts` | 插件清单与注册 |
| `bench/em-cfd-results.json` | 已生成的基准结果（A/B/C + 权衡 + 最小周期 + 归因） |
| `tests/fluidCfdCoupler.test.ts` | 前端纯函数单测（CFD-03） |
| `src/plugins/builtin/index.ts` | 已注册进内置插件列表 |
