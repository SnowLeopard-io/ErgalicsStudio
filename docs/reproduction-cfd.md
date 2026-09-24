# 复现指南：CFD 管网—3D 场双向耦合（fluid-cfd-coupler）

> 本指南针对**【赛题方向：一维管网与三维流场双向耦合】**独立复现。
> 对应电磁谐振方向赛题见 `docs/reproduction-em.md`。
> 数值模块：`src/plugins/builtin/fluid-cfd-coupler/python/`，内核为纯 NumPy 包 `fluid_cfd`。

---

## 1. 前置条件

| 依赖 | 用途 | 缺失时 |
| --- | --- | --- |
| Python 3.10+ | 运行数值内核 | 不可运行 |
| numpy | 数值内核必需 | 不可运行 |
| scipy | 稀疏求解（可选） | 自动回退纯 NumPy 后端，结果一致，仅性能略降 |

## 2. 一键复现

```bash
# 仅验证本赛题
node scripts/repro-plugins.mjs --only=fluid

# 快速模式（本赛题无重型算例，与完整模式步骤一致）
node scripts/repro-plugins.mjs --only=fluid --fast
```

脚本对插件按序执行：

```
1. env    —— 定位可用 python，读取 numpy / scipy 版本
2. tests  —— 运行独立断言套件 python/run_tests.py
3. gen    —— 通过同一入口 driver.py 在临时目录重新生成基准 JSON
4. verify —— 逐字段对比新 JSON 与已提交基准 bench/fluid-cfd-results.json
```

退出码：
- `0` —— 测试通过，全部确定性科学字段与基准一致；
- `1` —— 测试失败，或存在确定性科学字段漂移。

## 3. 手动复现

```bash
cd src/plugins/builtin/fluid-cfd-coupler/python

python -m fluid_cfd.driver verify              # Case A/B/C/D + 亚临界曲线 + 权衡 + 敏感性
python run_tests.py                            # 期望 24 passed, 0 failed
python benchmarks/bench_coupling.py            # 生成基准 JSON
```

注意：`bench_coupling.py` 会直接写入 `bench/fluid-cfd-results.json`（即脚本用于比对的基准文件）。仅当刻意为本赛题更新基准时执行，否则用脚本的临时目录重生成避免覆盖提交态。

## 4. 判定口径

脚本内置确定性字段比较器，把基准 JSON 字段按四类判定：

| 类别 | 判定方式 | 示例 |
| --- | --- | --- |
| 精确断言 | 字符串 / 布尔必须完全相等 | `ok`、`subsonic_engaged`、`converged` |
| 确定性数值 | 相对误差 ≤ 1e-6 | `flow_rel_error`、`pressure_rel_error`、`valve_throttle_ratio`、`min_feasible_exchange_period_ms` |
| 机器相关 | 忽略或软容差（note 不判 FAIL） | `seconds`、`exchange_latency`、`composite_score`（内含墙钟延迟等机器量） |

- `composite_score` 属机器相关：`trade_off` 综合评分将交换延迟以固定权重混入，延迟为墙钟量，跨机器漂移属预期，判 note。
- 长度不一的数组（如各 case 的 `windows`）按下标对齐逐项比较；元素带 `case` 名的按 `case@method` 复合身份对齐，避免与同 param 异配置的条目错配。
- 软项（note）不计入 FAIL；仅精确断言与确定性数值违背机组失败。

## 5. 输出解读

`--only=fluid` 成功输出示例：

```
=== fluid-cfd-coupler (CFD) reproduction: env → tests → regenerate → verify ===
python 3.10.11 | numpy 2.2.6 | scipy 1.15.3

[fluid-cfd-coupler]
  ok   fluid-cfd-coupler: standalone test suite passed
  ok   fluid-cfd-coupler: fresh bench matches committed baseline on all deterministic scientific fields
  note fluid-cfd-coupler: ...trade_off[0].composite_score rel=0.00% (latency-blended, within tolerance)

==========================================
RESULT: PASS — fluid-cfd-coupler reproduces and match committed baselines
==========================================
```

- `ok ... matches committed baseline`：新算结果与提交基准在全部确定性科学字段上一致。
- `note ... (latency-blended)`：机器相关量漂移，符合预期，不计失败。
- `FAIL` 行按以下顺序排查：① 测试套件是否通过；② 基准文件是否存在；③ 重生成是否报错；④ 哪些科学字段偏离（脚本打印字段路径与新旧值）。

## 6. 故障排查

| 现象 | 处置 |
| --- | --- |
| python discovery 失败 | 安装 Python 3.10+，或设环境变量 `PYTHON=/path/to/python` |
| numpy `<none>` | `pip install numpy` |
| scipy `<none>` | 可选；内核自动用纯 NumPy 后端，结果一致 |
| 某科学字段 FAIL | 按第 5 节顺序排查 |

## 7. 交付物对照

| 交付项 | 位置 |
| --- | --- |
| 一键复现脚本 | `scripts/repro-plugins.mjs`（`--only=fluid`） |
| 数值内核 + 验证 | `src/plugins/builtin/fluid-cfd-coupler/python/`（24 项测试） |
| 解题说明书 | `src/plugins/builtin/fluid-cfd-coupler/SOLUTION.md` |
| 复现基准 | `bench/fluid-cfd-results.json` |