// ==========================================================================
// Greenhouse effect — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const greenhouseManifest: PluginManifest = {
  id: 'example.env-greenhouse',
  name: 'Greenhouse Effect',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Zero-D radiative-balance model: CO₂ / albedo / cloud sliders drive equilibrium warming.',
  nameI18n: {
    'zh-CN': '温室效应模拟',
    'en-US': 'Greenhouse Effect',
  },
  descriptionI18n: {
    'zh-CN': '零维辐射收支教学模型：拖动 CO₂ 浓度、地表反照率与云量滑块，用 Myhre 辐射强迫公式（ΔF=5.35·ln(C/C₀)）与气候敏感度 λ 估算平衡温升 ΔT。展示「增大 CO₂ / 降低反照率 → 辐射强迫↑ → 平衡温升↑」的单调趋势。教学示意，不能用于预测真实气候。',
    'en-US': 'A zero-dimensional radiative-balance teaching model: CO₂, albedo and cloud sliders drive radiative forcing (Myhre 1998) and equilibrium warming ΔT via a fixed climate sensitivity λ — showing the monotonic chain CO₂↑ / albedo↓ → forcing↑ → warming↑. Teaching only, not a climate forecast.',
  },
  license: 'MIT',
  entry: 'example.env-greenhouse',
  category: 'scientific',
};
