import type { PluginManifest } from '@/types/plugin';

export const simSdManifest: PluginManifest = {
  id: 'example.sim-sd',
  name: 'System Dynamics Studio',
  nameI18n: { 'zh-CN': '系统动力学工作台', 'en-US': 'System Dynamics Studio' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Stock-and-flow system dynamics studio: editable JSON model spec with rate equations, Euler/RK4 integration, causal-loop diagram with polarity, feedback-loop detection with a documented loop-dominance heuristic, parameter sweeps and behavior-over-time plots. Built-in templates: logistic population, Lotka-Volterra, 2-stage supply chain, 2-box climate carbon, Bass diffusion.',
  descriptionI18n: {
    'zh-CN':
      '存量-流量系统动力学工作台：可编辑 JSON 模型规格与速率方程、Euler/RK4 积分、带极性的因果回路图、反馈回路检测与文档化的回路主导性启发式、参数扫描与行为随时间变化图。内置模板：逻辑斯蒂人口、Lotka-Volterra、两级供应链、两箱气候碳循环、Bass 扩散。',
    'en-US':
      'Stock-and-flow system dynamics studio: editable JSON model spec with rate equations, Euler/RK4 integration, causal-loop diagram with polarity, feedback-loop detection with a documented loop-dominance heuristic, parameter sweeps and behavior-over-time plots. Built-in templates: logistic population, Lotka-Volterra, 2-stage supply chain, 2-box climate carbon, Bass diffusion.',
  },
  license: 'MIT',
  entry: 'example.sim-sd',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { time: 'model time unit' },
    reproducible: true,
    notes:
      'Fully deterministic (no stochastic elements). Expressions are parsed once by a shunting-yard evaluator to RPN (no eval/Function) and evaluated in topological order over the acyclic auxiliary/flow graph; circular non-stock dependencies are rejected at compile time. Stocks integrate net flows (inflows minus outflows) with explicit Euler or classic RK4. Loop detection enumerates simple cycles (length <= 6) over the derived causal graph; the loop-dominance readout is a documented one-step sensitivity heuristic (|d(rate)/d(stock)| normalized by the baseline relative rate), not a formal eigenvalue analysis.',
    notesI18n: {
      'zh-CN':
        '完全确定性（无随机成分）。表达式经 shunting-yard 解析器一次性编译为 RPN（不使用 eval/Function），在无环的辅助变量/流量依赖图上按拓扑序求值；非存量节点间的循环依赖在编译期报错。存量按净流量（流入减流出）以显式 Euler 或经典 RK4 积分。回路检测在派生因果图上枚举长度 ≤6 的简单环；回路主导性为文档化的一步敏感性启发式（|d(rate)/d(stock)| 以基线相对速率归一），并非严格的特征值分析。',
      'en-US':
        'Fully deterministic (no stochastic elements). Expressions are parsed once by a shunting-yard evaluator to RPN (no eval/Function) and evaluated in topological order over the acyclic auxiliary/flow graph; circular non-stock dependencies are rejected at compile time. Stocks integrate net flows (inflows minus outflows) with explicit Euler or classic RK4. Loop detection enumerates simple cycles (length <= 6) over the derived causal graph; the loop-dominance readout is a documented one-step sensitivity heuristic (|d(rate)/d(stock)| normalized by the baseline relative rate), not a formal eigenvalue analysis.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'SD model spec JSON' }],
};
