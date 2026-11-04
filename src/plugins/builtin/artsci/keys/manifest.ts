import type { PluginManifest } from '@/types/plugin';

export const keysManifest: PluginManifest = {
  id: 'example.keys',
  name: 'Keyboard Performance',
  nameI18n: { 'zh-CN': '键盘演奏', 'en-US': 'Keyboard Performance' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Playable on-screen piano: click keys or use the computer keyboard (Z-M and QWERTY rows) to play in real time through the Web Audio engine. Additive timbres — grand piano, bowed violin, pipe organ, flute and music box — with ADSR envelopes, vibrato and low-pass shaping; pressed-key visual feedback, sustain hold, octave shift and volume.',
  descriptionI18n: {
    'zh-CN':
      '可演奏的屏幕钢琴：点击琴键或使用电脑键盘（Z–M 与 QWERTY 两排）通过 Web Audio 引擎实时发声。加法合成音色——三角钢琴、小提琴、管风琴、长笛、八音盒——含 ADSR 包络、颤音与低通整形；按键视觉反馈、延音、八度切换与音量调节。',
    'en-US':
      'Playable on-screen piano: click keys or use the computer keyboard (Z-M and QWERTY rows) to play in real time through the Web Audio engine. Additive timbres — grand piano, bowed violin, pipe organ, flute and music box — with ADSR envelopes, vibrato and low-pass shaping; pressed-key visual feedback, sustain hold, octave shift and volume.',
  },
  license: 'MIT',
  entry: 'example.keys',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { frequency: 'Hz', time: 's', gain: 'dBFS', index: 'dimensionless' },
    benchmarks: [
      'note-a4',
      'note-c4',
      'layout',
      'bindings',
      'env-attack',
      'env-sustain',
      'env-release',
    ],
    reproducible: true,
    notes:
      'Timbres are additive harmonic stacks rendered by Web Audio oscillator stacks (createPeriodicWave); envelopes are piecewise-linear ADS with a linear release, evaluated in kernel.ts so tests and the live engine share the same math. Equal temperament, A4 = 440 Hz. This is a performance/teaching instrument, not a sampled soundfont.',
    notesI18n: {
      'zh-CN':
        '音色为加法谐波叠堆，由 Web Audio 振荡器组（createPeriodicWave）实时渲染；包络为分段线性 ADS 加线性释音，在 kernel.ts 中求值，测试与实时引擎共用同一套数学。十二平均律，A4 = 440 Hz。本插件是演奏/教学乐器，不是采样音源。',
      'en-US':
        'Timbres are additive harmonic stacks rendered by Web Audio oscillator stacks (createPeriodicWave); envelopes are piecewise-linear ADS with a linear release, evaluated in kernel.ts so tests and the live engine share the same math. Equal temperament, A4 = 440 Hz. This is a performance/teaching instrument, not a sampled soundfont.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'performance settings snapshot' }],
};
