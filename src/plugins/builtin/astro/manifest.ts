// ==========================================================================
// Astronomy pipeline plugin — manifest
//
// Research-grade CCD image pipeline: FITS I/O, synthetic frame generation,
// bias/dark/flat calibration with cosmic-ray clipping, background estimation,
// star detection and aperture photometry with CCD-equation SNR.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const astroManifest: PluginManifest = {
  id: 'astro.pipeline',
  name: 'Astronomy CCD Pipeline',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'FITS-native CCD reduction pipeline: bias/dark/flat calibration with cosmic-ray rejection, sigma-clipped background statistics, local-maximum star detection and aperture photometry (CCD-equation SNR, instrumental magnitudes), plus a deterministic Moffat-PSF frame simulator.',
  nameI18n: {
    'zh-CN': '天文 CCD 管线',
    'en-US': 'Astronomy CCD Pipeline',
  },
  descriptionI18n: {
    'zh-CN':
      '科研级 CCD 图像处理管线：FITS 格式读写，偏置/暗场/平场校准与宇宙线剔除，σ 裁剪背景统计，局部极大值恒星检测与孔径测光（CCD 方程信噪比、仪器星等），并内置确定性 Moffat 星象仿真器用于端到端验证。',
    'en-US':
      'Research-grade CCD reduction: FITS I/O, bias/dark/flat calibration with cosmic-ray rejection, sigma-clipped background, local-maximum star detection and aperture photometry (CCD-equation SNR, instrumental magnitudes), with a deterministic Moffat-PSF simulator for end-to-end validation.',
  },
  license: 'MIT',
  entry: 'astro.pipeline',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { flux: 'ADU', fluxE: 'e⁻', magnitude: 'mag', angle: 'px' },
    reproducible: true,
    benchmarks: [
      'Synthetic star flux recovery within 5 % (aperture radius = 2×FWHM)',
      'CCD-equation SNR agrees with Monte-Carlo frame scatter within 10 %',
      'FITS round-trip: written frames re-read bit-exact through BSCALE/BZERO',
    ],
    notes:
      'Standard CCD reduction chain (bias/dark/flat, normalised master flat, 6-σ Laplacian cosmic-ray clip), 2.5σ sigma-clipped background, 5×5 flux-weighted centroiding, DAOPHOT-style aperture photometry with median annulus sky. Photometric zeropoint defaults to 25 mag (instrumental system). Simulation: Moffat PSF (β = 2.5), Poisson shot noise, Gaussian read noise, cos⁴ vignetting flat — deterministic mulberry32 seed. No astrometric solving, no PSF-fitting photometry.',
    notesI18n: {
      'zh-CN':
        '标准 CCD 缩减链（偏置/暗场/平场，归一化主平场，6σ Laplacian 宇宙线剔除）、2.5σ σ-裁剪背景、5×5 流量加权质心、DAOPHOT 风格孔径测光（环带中值天空）。测光零点默认 25 mag（仪器系统）。仿真：Moffat 星象（β=2.5）、泊松散粒噪声、高斯读出噪声、cos⁴ 渐晕平场，mulberry32 确定性种子。不含天测拟合与 PSF 拟合测光。',
      'en-US':
        'Standard CCD reduction (bias/dark/flat with normalised master, 6-σ Laplacian CR clip), 2.5σ sigma-clipped background, 5×5 flux-weighted centroids, DAOPHOT-style aperture photometry with median annulus sky. Zeropoint defaults to 25 mag (instrumental system). Simulation: Moffat PSF (β = 2.5), Poisson shot noise, Gaussian read noise, cos⁴ vignetting flat — deterministic mulberry32 seed. No astrometric solving or PSF-fitting photometry.',
    },
  },
  formats: [
    { extension: '.fits', mimeTypes: ['application/octet-stream', 'image/fits'], description: 'FITS 2-D image (BITPIX 8/16/32/-32/-64, BSCALE/BZERO, TAN WCS)' },
    { extension: '.fit', mimeTypes: ['application/octet-stream'], description: 'FITS 2-D image (alternate extension)' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'Pipeline / simulation preset' },
  ],
};
