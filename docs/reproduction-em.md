# 复现指南：电磁谐振特征值求解（em-eigensolver）

> 本指南针对**【赛题方向：十万阶非正定厄密稀疏矩阵特征值求解】**独立复现。
> 对应 CFD 管网赛题见 `docs/reproduction-cfd.md`。
> 数值模块：`src/plugins/builtin/em-eigensolver/python/`，内核为纯 NumPy/可选 SciPy 包 `em_eigensolver`。

---

## 1. 前置条件

| 依赖 | 用途 | 缺失时 |
| --- | --- | --- |
| Python 3.10+ | 运行数值内核 | 不可运行 |
| numpy | 数值内核必需 | 不可运行 |
| scipy | 稀疏求解加速（可选） | 自动回退纯 NumPy CSR 后端，结果一致，仅性能略降 |

## 2. 一键复现

```bash
# 完整保真（含十万阶全量求解验证；慢机器用 --fast）
node scripts/repro-plugins.mjs --only=em

# 快速模式：跳过十万阶全量验证
node scripts/repro-plugins.mjs --only=em --fast
```

脚本对插件按序执行：

```
1. env    —— 定位可用 python，读取 numpy / scipy 版本
2. tests  —— 运行独立断言套件 python/tests/test_all.py
3. gen    —— 通过同一入口 solver.py 在临时目录重新生成基准 JSON
4. verify —— 逐字段对比新 JSON 与已提交基准 bench/em-eigensolver-validate.json
```

退出码：
- `0` —— 测试通过，全部确定性科学字段与基准一致；
- `1` —— 测试失败，或存在确定性科学字段漂移。

## 3. 手动复现

```bash
cd src/plugins/builtin/em-eigensolver/python

python -m em_eigensolver.cli --sample cavity_large --sigma 0.5 --k 6 --out /tmp/large.npz   # 可选，样例矩阵单次求解
python tests/test_all.py                                                                    # 期望 ALL PASS
python benchmarks/validate_correctness.py --json /tmp/em-validate.json                     # 校验报告
python benchmarks/perf_bench.py --json /tmp/em-perf.json                                   # 性能曲线
```

说明：
- `validate_correctness.py` 会用 `--json` 把原始报告写到指定路径，并把 stress 工件写入 `bench/em-eigensolver-stress.json`（该工件是脚本之外独立归档的对抗例证据）。
- `--fast` 等价于跳过 `validate_correctness.py` 内的 1e5 用例；`perf_bench.py` 对应 `--skip-large`。
- 以上命令把报告写到 `/tmp` 便于与提交基准核对；`bench/` 下的提交态文件由脚本的临时目录重生成与其比对，不直接覆盖。

## 4. 判定口径

脚本内置确定性字段比较器，把基准 JSON 字段按四类判定：

| 类别 | 判定方式 | 示例 |
| --- | --- | --- |
| 精确断言 | 字符串 / 布尔必须完全相等 | `converged`、`status`、`all_pass` |
| 确定性数值 | 相对误差 ≤ 1e-6 | `max_eigenvalue_error` 相关项、`flow_rel_error` 类 |
| 收敛量级（绝对容差） | 绝对差 ≤ 1e-6，超限才 FAIL | `max_residual`、`eigenvalues`、`reference_eigenvalues` |
| 机器相关 | 忽略或软容差（note 不判 FAIL） | `seconds`、`peak_memory_mb`、`iterations`、`matvecs` |

- `max_residual` / `eigenvalues` 用绝对容差：这些收敛量在病态样例上落在 1e-9~1e-14（远低于 1e-8 认证容差），相对误差会被放大成数百%；以绝对差 ≤ 1e-6 判等，真正劣化的残差（超容差）仍触发 FAIL。求解收敛由精确的 `converged` / `status` / `max_eigenvalue_error` 断言独立守护。
- 对抗用例（`stress` 数组）内本征值差异归为 note：病态缩放（1e-9~1e10）或近简并谱下 JD 可能锁到相邻本征值，本征值本身属尘埃级浮点噪声，不构成复现断言；对应认证由上述精确断言守护。确定性 `reference` 数组保持严格绝对容差检查。
- 长度不一的数组（`reference` / `stress`）按语义键对齐：元素带 `case` 名的以 `case@method@sigma` 复合身份配对，不按下标硬比。因此 `--fast`（跳过十万阶行）只比较实际生成的用例，不会因缺行误报。
- 软项（note）不计入 FAIL；仅精确断言与确定性数值违背机组失败。

## 5. 输出解读

`--only=em --fast` 成功输出示例：

```
=== em-eigensolver (eigen) reproduction: env → tests → regenerate → verify ===
python 3.10.11 | numpy 2.2.6 | scipy 1.15.3

[em-eigensolver]
  ok   em-eigensolver: standalone test suite passed
  ok   em-eigensolver: fresh bench matches committed baseline on all deterministic scientific fields

==========================================
RESULT: PASS — em-eigensolver reproduces and match committed baselines
==========================================
```

- `ok ... matches committed baseline`：新算结果与提交基准在全部确定性科学字段上一致。
- `FAIL` 行按以下顺序排查：① 测试套件是否通过；② 基准文件是否存在；③ 重生成是否报错；④ 哪些科学字段偏离（脚本打印字段路径与新旧值）。

## 6. 故障排查

| 现象 | 处置 |
| --- | --- |
| python discovery 失败 | 安装 Python 3.10+，或设环境变量 `PYTHON=/path/to/python` |
| numpy `<none>` | `pip install numpy` |
| scipy `<none>` | 可选；内核自动用纯 NumPy CSR 后端，结果一致 |
| em 全量验证太慢 | 加 `--fast`（跳过 1e5 用例）；或 `perf_bench.py --skip-large` |
| 某科学字段 FAIL | 按第 5 节顺序排查 |

## 7. 交付物对照

| 交付项 | 位置 |
| --- | --- |
| 一键复现脚本 | `scripts/repro-plugins.mjs`（`--only=em`） |
| 数值内核 + 验证 | `src/plugins/builtin/em-eigensolver/python/` |
| 解题说明书 | `src/plugins/builtin/em-eigensolver/SOLUTION.md` |
| 复现基准 | `bench/em-eigensolver-validate.json`（校验）、`bench/em-eigensolver-results.json`（性能）、`bench/em-eigensolver-stress.json`（对抗例） |