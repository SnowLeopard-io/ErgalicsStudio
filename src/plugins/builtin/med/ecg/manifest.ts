import type { PluginManifest } from '@/types/plugin';

export const medEcgManifest: PluginManifest = {
  id: 'example.med-ecg',
  name: 'ECG Analyzer',
  nameI18n: { 'zh-CN': '心电图分析仪', 'en-US': 'ECG Analyzer' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  description:
    'Beat detection and heart-rate variability for single- or multi-lead ECG text / WFDB records: Pan-Tompkins style R-peak finding, P-QRS-T annotation, time- and frequency-domain HRV, and rule-based rhythm screening with rhythm-strip and HRV-spectrum views.',
  descriptionI18n: {
    'zh-CN':
      '面向单导联/多导联心电记录（文本表格或 WFDB）的逐拍检测与心率变异性分析：Pan-Tompkins 式 R 峰检测、P/QRS/T 标注、时域与频域 HRV 指标、规则法心律筛查，提供节律条与 HRV 频谱两种视图。',
    'en-US':
      'Beat detection and HRV for single- or multi-lead ECG records (text tables or WFDB): Pan-Tompkins style R-peak detection, P-QRS-T annotation, time- and frequency-domain HRV metrics, rule-based rhythm screening, with rhythm-strip and HRV-spectrum views.',
  },
  entry: 'example.med-ecg',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { time: 'ms', rr: 'ms', heartRate: 'bpm' },
    reproducible: true,
    notes:
      'Teaching-grade rule/threshold detection (Pan-Tompkins pipeline, fixed QRS/P/T heuristics, LF/HF band integration); intended for education and signal-processing demonstration, not for clinical diagnosis.',
    notesI18n: {
      'zh-CN':
        '教学级规则/阈值检测（Pan-Tompkins 管线、固定的 QRS/P/T 启发式、LF/HF 频段积分），用于教学与信号处理演示，不构成临床诊断。',
      'en-US':
        'Teaching-grade rule/threshold detection (Pan-Tompkins pipeline, fixed QRS/P/T heuristics, LF/HF band integration); intended for education and signal-processing demonstration, not for clinical diagnosis.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:b4c5b02139f0dd386dde3b8fe91cf966',
    sig: '0076400b97e66e20c7b4912716542938f06588bd1ba6c71d71712444fb34e2f707c32595fe69c516d6606e32681faa790116cce44fdb722ca0a4083787744c00',
    signer: 'Ergalics Studio (med pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '25f660c62a9e6bb7d3108bb59667b99d49f7fa2a60df6308361226303a751e55',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'time column plus lead columns in mV (time(s),II)' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace-separated samples or time + lead columns' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'WFDB 16-bit LE signal file (open the matching .hea first)' },
    { extension: '.hea', mimeTypes: ['text/plain'], description: 'WFDB header (prompts for the matching .dat file)' },
  ],
};
