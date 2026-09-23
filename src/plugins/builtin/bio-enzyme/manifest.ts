import type { PluginManifest } from '@/types/plugin';

export const bioEnzymeManifest: PluginManifest = {
  id: 'example.bio-enzyme',
  name: 'Enzyme Kinetics',
  nameI18n: { 'zh-CN': '酶动力学', 'en-US': 'Enzyme Kinetics' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Michaelis-Menten enzyme kinetics with competitive / non-competitive / uncompetitive inhibition, Lineweaver-Burk linearisation and a Levenberg-Marquardt fit that recovers Vmax & Km from noisy progress data.',
  descriptionI18n: {
    'zh-CN':
      'Michaelis-Menten 酶动力学：支持竞争性 / 非竞争性 / 反竞争性抑制、Lineweaver-Burk 线性化，并用 Levenberg-Marquardt 拟合从含噪初速度数据中反解 Vmax 与 Km，输出 kcat、催化效率与拟合优度。',
    'en-US':
      'Michaelis-Menten kinetics with competitive / non-competitive / uncompetitive inhibition, Lineweaver-Burk linearisation, and a Levenberg-Marquardt fit recovering Vmax & Km from noisy initial-rate data, plus kcat, catalytic efficiency and fit quality.',
  },
  license: 'MIT',
  entry: 'example.bio-enzyme',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'substrate,v_{0} initial-rate data' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated substrate / v₀ columns' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON array of {s,v} or {substrate,v0} points' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'whitespace-separated substrate, v₀ columns' },
  ],
};