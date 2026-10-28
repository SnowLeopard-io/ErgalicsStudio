import type { PluginManifest } from '@/types/plugin';

export const bioNeuronManifest: PluginManifest = {
  id: 'example.bio-neuron',
  name: 'Hodgkin–Huxley Neuron',
  nameI18n: { 'zh-CN': 'Hodgkin–Huxley 神经元', 'en-US': 'Hodgkin–Huxley Neuron' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Hodgkin & Huxley (1952) action-potential model with the original published constants (gNa=120, gK=36, gL=0.3 mS/cm²; ENa=50, EK=−77, EL=−54.4 mV). Four-variable RK4 integration, m/h/n gating traces, injected-current pulses and sustained current, Q10=3 temperature scaling, run/pause/reset playback.',
  descriptionI18n: {
    'zh-CN':
      'Hodgkin & Huxley（1952）动作电位模型，采用 1952 年原始发表常数（gNa=120、gK=36、gL=0.3 mS/cm²；ENa=50、EK=−77、EL=−54.4 mV）。四变量 RK4 积分，展示 V(t) 与 m/h/n 门控波形，支持电流脉冲与持续电流注入、Q10=3 温度标度与运行/暂停/重置回放。',
    'en-US':
      'Hodgkin & Huxley (1952) action-potential model with the original published constants (gNa=120, gK=36, gL=0.3 mS/cm²; ENa=50, EK=−77, EL=−54.4 mV). Four-variable RK4 integration, m/h/n gating traces, injected-current pulses and sustained current, Q10=3 temperature scaling, run/pause/reset playback.',
  },
  license: 'MIT',
  entry: 'example.bio-neuron',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { voltage: 'mV', current: 'µA/cm²', conductance: 'mS/cm²' },
    benchmarks: ['hh-fixed-point', 'hh-excitability', 'hh-fi-monotonic'],
    reproducible: true,
    notes:
      'Embedded validation battery on the 1952 constants: rest-state fixed point |V−(−65)| < 0.5 mV over 100 ms; 10 µA·2 ms pulse → spike peak > 0 mV; 2 µA·2 ms pulse stays subthreshold (peak < 0 mV) and returns to rest within 1 mV; firing rate monotonic for sustained 10/20/40 µA/cm². Source: Hodgkin & Huxley, J. Physiol. 117:500-544 (1952).',
    notesI18n: {
      'zh-CN':
        '基于 1952 年原始常数的内嵌验证：静息不动点 100 ms 内 |V−(−65)| < 0.5 mV；10 µA·2 ms 脉冲 → 峰电位 > 0 mV；2 µA·2 ms 脉冲保持阈下（峰值 < 0 mV）且回落到静息 1 mV 以内；持续电流 10/20/40 µA/cm² 发放频率单调递增。出处：Hodgkin & Huxley, J. Physiol. 117:500-544 (1952)。',
      'en-US':
        'Embedded validation battery on the 1952 constants: rest-state fixed point |V−(−65)| < 0.5 mV over 100 ms; 10 µA·2 ms pulse → spike peak > 0 mV; 2 µA·2 ms pulse stays subthreshold (peak < 0 mV) and returns to rest within 1 mV; firing rate monotonic for sustained 10/20/40 µA/cm². Source: Hodgkin & Huxley, J. Physiol. 117:500-544 (1952).',
    },
  },
};
