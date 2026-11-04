// ==========================================================================
// Gray–Scott reaction–diffusion Turing-pattern lab plugin — manifest
//
// Interactive reactor: explicit FTCS integration of the Gray–Scott model on
// an N×N periodic grid, Pearson (1993) classic (f,k) regime presets, run /
// pause / reset controls and colour-mapped pattern rendering.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const chemTuringManifest: PluginManifest = {
  id: 'example.chem-turing',
  name: 'Gray–Scott Turing Patterns',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Gray–Scott reaction–diffusion Turing-pattern laboratory: explicit FTCS integration of Du∇²u − uv² + f(1−u) / Dv∇²v + uv² − (f+k)v on a periodic grid, Pearson (1993) classic regime presets (spots, worms, U-skate, mitosis…), run/pause/reset, and mass-conservation & finiteness benchmarks.',
  nameI18n: {
    'zh-CN': 'Gray-Scott 反应扩散图灵斑图',
    'en-US': 'Gray–Scott Turing Patterns',
  },
  descriptionI18n: {
    'zh-CN':
      'Gray-Scott 反应-扩散方程图灵斑图实验室：FTCS 显式差分在 N×N 周期网格上演化 Du∇²u − uv² + f(1−u) / Dv∇²v + uv² − (f+k)v，内置 Pearson (1993) 经典分区预设（斑点/蠕虫/U-skate/有丝分裂等）、运行/暂停/重置控制，以及封闭体系质量守恒与有限性数值基准。',
    'en-US':
      'Gray–Scott reaction–diffusion Turing-pattern lab: explicit FTCS integration of Du∇²u − uv² + f(1−u) / Dv∇²v + uv² − (f+k)v on an N×N periodic grid, with Pearson (1993) classic regime presets (spots / worms / U-skate / mitosis…), run-pause-reset controls, and closed-reactor mass-conservation & finiteness benchmarks.',
  },
  license: 'MIT',
  entry: 'example.chem-turing',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'demonstration',
    units: { feedRate: '1/t', killRate: '1/t', diffusivity: 'l²/t' },
    benchmarks: ['grayscott-mass-conservation', 'grayscott-finiteness', 'grayscott-pearson-spots'],
    reproducible: true,
    notes:
      'Interactive demonstration-grade plugin on real Gray–Scott numerics: FTCS with the 5-point Laplacian and periodic boundaries (stability dt ≤ 1/(4·max(Du,Dv))). Benchmarks verify (i) exact closed-reactor mass conservation of Σ(u+v) for f=k=0, (ii) finiteness over 5000 steps at standard parameters, and (iii) a qualitative Pearson (1993) spot-regime anchor at (f,k)=(0.030,0.062) via coverage/contrast/correlation-length criteria — a qualitative, not quantitative, anchor.',
    notesI18n: {
      'zh-CN':
        '交互演示级插件，内核为真实 Gray-Scott 数值：FTCS + 五点拉普拉斯 + 周期边界（稳定性要求 dt ≤ 1/(4·max(Du,Dv))）。基准验证：① f=k=0 封闭体系 Σ(u+v) 质量守恒；② 标准参数 5000 步无 NaN/Inf；③ (f,k)=(0.030,0.062) 斑点区 Pearson (1993) 定性锚点（覆盖率/对比度/相关长度判据，属定性判据而非定量预测）。',
      'en-US':
        'Interactive demonstration-grade plugin on real Gray–Scott numerics: FTCS with the 5-point Laplacian and periodic boundaries (stability dt ≤ 1/(4·max(Du,Dv))). Benchmarks verify (i) exact closed-reactor mass conservation of Σ(u+v) for f=k=0, (ii) finiteness over 5000 steps at standard parameters, and (iii) a qualitative Pearson (1993) spot-regime anchor at (f,k)=(0.030,0.062) via coverage/contrast/correlation-length criteria — a qualitative, not quantitative, anchor.',
    },
  },
  formats: [],
};
