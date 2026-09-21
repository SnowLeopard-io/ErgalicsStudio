# fluid_cfd — 1D 管网 ↔ 3D 场 双向耦合内核

`fluid_cfd` 是附属于 fluid-cfd-coupler 插件的纯 NumPy 数值内核。它将**粗时间步的
1-D 管网/喷管网络**与**细时间步的 3-D 标量场求解器**通过**多速率子循环
（multi-rate sub-cycling）** 在交换窗口（exchange window）处双向耦合起来，
同时提供毫秒级阀门控制逻辑、守恒性审计以及精度-效率权衡曲线。

> 本目录是可独立运行的 Python 包，与浏览器插件共用同一条代码路径
> （`driver.py`）。浏览器结果与 CLI 结果完全一致。

## 目录结构

```
python/
├── fluid_cfd/
│   ├── __init__.py     # 包导出 + 规范引用
│   ├── units.py        # 单位约定、物性常数、无量纲一致性检验
│   ├── analytic.py     # 解析解（临界流量、放气背压）——验证基准
│   ├── network_1d.py   # 1-D 管网求解器 + 阀门控制逻辑
│   ├── domain_3d.py    # 3-D 场求解器（扩散/平流 + 入口注入）
│   ├── coupler.py      # 交换窗口子循环、双向边界耦合、守恒审计
│   ├── verify.py       # Case A / Case B / 权衡曲线验证
│   └── driver.py       # JSON 驱动（CLI / Pyodide / benchmark 共用）
├── run_tests.py        # 纯断言测试运行器（无需 pytest）
├── benchmarks/bench_coupling.py
├── config.example.json # solve_json 自定义 payload 示例
└── requirements.txt
```

## 安装与依赖

只依赖 `numpy`（纯 NumPy 设计，无需其它科学栈）：

```bash
pip install -r requirements.txt
```

## 快速验证

```bash
# 运行完整验证套件（Case A + Case B + 权衡曲线）→ JSON 到 stdout
python -m fluid_cfd.driver verify

# 运行一个耦合（自定义或内置算例），payload 可选
python -m fluid_cfd.driver solve '{"case":"a"}'
python -m fluid_cfd.driver solve '{"net":{...},"dom":{...},"cpl":{...}}'

# 逐项单元测试（8 项断言，无需 pytest）
python run_tests.py
```

## 接口约定（跨 1D-3D 的单位契约）

接口上所有量均以 **SI 基本单位**传递，派生量（流量 kg/s、压力 Pa、温度 K、
相态 0..1）都带有标签，使两侧绝不误解量级。`units.consistent(a, b)`
是无量纲的一致性检验，用于验证两个值是否指同一物理量。

## JSON payload（`solve_json` 契约）

```js
{
  "case": "a" | "b" | null,    // 快捷内置算例；此时忽略 net/dom/cpl
  "net":  { ...NetworkConfig 覆盖 },
  "dom":  { ...DomainConfig 覆盖 },
  "cpl":  { ...CouplerConfig 覆盖 }
}
```

见 `config.example.json` 的完整自定义示例。

## 三个验证算例

| 算例 | 内容 | 关键指标 |
| --- | --- | --- |
| Case A | 定常壅塞流 | 临界流量解析解、放气背压 |
| Case B | 毫秒级阀门阶跃控制 | 节流比、控制同步误差（max/mean） |
| 权衡曲线 | 交换周期扫描 | 延迟 vs 界面误差 vs 综合评分 |