import type { PluginManifest } from '@/types/plugin';

export const synthManifest: PluginManifest = {
  id: 'example.synth',
  name: 'Synthesizer Lab',
  nameI18n: { 'zh-CN': '合成器实验室', 'en-US': 'Synthesizer Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Sound-design workbench: sine/square/saw/triangle and additive-wavetable oscillators, ADSR editor, FM synthesis, RBJ low/high/band/notch biquad filters with analytic frequency response, LFO modulation, presets, offline rendering and 16-bit WAV export.',
  descriptionI18n: {
    'zh-CN':
      '声音设计工作台：正弦/方波/锯齿/三角与加法波表振荡器、ADSR 包络编辑、FM 合成、RBJ 低通/高通/带通/陷波双二阶滤波器及解析频响、LFO 调制、预设、离线渲染与 16-bit WAV 导出。',
    'en-US':
      'Sound-design workbench: sine/square/saw/triangle and additive-wavetable oscillators, ADSR editor, FM synthesis, RBJ low/high/band/notch biquad filters with analytic frequency response, LFO modulation, presets, offline rendering and 16-bit WAV export.',
  },
  license: 'MIT',
  entry: 'example.synth',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { frequency: 'Hz', time: 's', gain: 'dBFS', index: 'dimensionless' },
    benchmarks: [
      'sine-rms',
      'adsr-peak',
      'adsr-sustain',
      'adsr-release',
      'lowpass-dc',
      'lowpass-dc-time',
      'notch-cutoff',
      'wave-square',
      'wave-saw',
      'wave-tri',
      'lfo-quarter',
      'note-a4',
    ],
    reproducible: true,
    notes:
      'Oscillators are evaluated at normalised phase (not band-limited; aliasing is expected at high pitches). ADSR is a piecewise-linear envelope with a gate equal to duration − release. Filters use the RBJ audio-EQ-cookbook biquad coefficients; the plotted magnitude response is the analytic |H(e^{jω})|, while rendering applies direct-form I. FM follows sin(2πf_c t + I·sin(2πf_m t)). Presets are rendered offline at 44.1 kHz and exported as 16-bit PCM WAV. This is a teaching/design tool, not a low-latency DAW.',
    notesI18n: {
      'zh-CN':
        '振荡器按归一化相位求值（未做限带处理，高音区会有混叠）。ADSR 为分段线性包络，门限时间 = 时长 − 释音。滤波器采用 RBJ audio-EQ-cookbook 双二阶系数；绘制的幅频响应是解析 |H(e^{jω})|，渲染时使用直接 I 型。FM 按 sin(2πf_c t + I·sin(2πf_m t))。预设在 44.1 kHz 离线渲染并导出为 16-bit PCM WAV。本插件是教学/设计工具，不是低延迟 DAW。',
      'en-US':
        'Oscillators are evaluated at normalised phase (not band-limited; aliasing is expected at high pitches). ADSR is a piecewise-linear envelope with a gate equal to duration − release. Filters use the RBJ audio-EQ-cookbook biquad coefficients; the plotted magnitude response is the analytic |H(e^{jω})|, while rendering applies direct-form I. FM follows sin(2πf_c t + I·sin(2πf_m t)). Presets are rendered offline at 44.1 kHz and exported as 16-bit PCM WAV. This is a teaching/design tool, not a low-latency DAW.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '0ac7989949dcc12fccdc898913f9362156181094d9877ebab42cc4f2b2a7df1abecbfab0cce19a6e7fa816444e1807215499405fa3c0bc53f013acc1afa64d0e',
    signer: 'Ergalics Studio (artsci pack)',
    signedAt: '2026-10-27T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'synth preset or array of presets' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'numeric note list (midi, duration_s)' },
  ],
};
