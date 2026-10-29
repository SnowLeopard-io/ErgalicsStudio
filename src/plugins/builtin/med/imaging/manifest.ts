import type { PluginManifest } from '@/types/plugin';

export const medImagingManifest: PluginManifest = {
  id: 'example.med-imaging',
  name: 'Medical Image Viewer',
  nameI18n: { 'zh-CN': '医学影像查看器', 'en-US': 'Medical Image Viewer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Teaching-level DICOM viewer: Part-10 header parsing (explicit/implicit VR little endian), Hounsfield conversion, slice browsing with window/level presets, threshold isosurface reconstruction in the Three.js scene, histogram-equalization and Sobel processing views, rectangular ROI statistics and CSV export of slice/ROI readouts.',
  descriptionI18n: {
    'zh-CN':
      '教学级 DICOM 查看器：解析 Part 10 头（显式/隐式 VR 小端）、HU 值转换、带窗宽窗位预设的切片浏览、Three.js 场景中的阈值等值面三维重建、直方图均衡与 Sobel 边缘处理视图、矩形 ROI 统计，以及切片/ROI 指标的 CSV 导出。',
    'en-US':
      'Teaching-level DICOM viewer: Part-10 header parsing (explicit/implicit VR little endian), Hounsfield conversion, slice browsing with window/level presets, threshold isosurface reconstruction in the Three.js scene, histogram-equalization and Sobel processing views, rectangular ROI statistics, and CSV export of slice/ROI readouts.',
  },
  license: 'MIT',
  entry: 'example.med-imaging',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { hu: 'HU', position: 'mm' },
    reproducible: true,
    notes:
      'Teaching-level parsing of uncompressed / common transfer syntaxes only (explicit and implicit VR little endian); bundled data are seeded simulated phantoms, not clinical images, and the viewer is not intended for clinical image diagnosis.',
    notesI18n: {
      'zh-CN':
        '仅支持无压缩/常见传输语法（显式与隐式 VR 小端）的教学级解析；数据为固定种子的模拟体模，非临床影像，不用于临床影像诊断。',
      'en-US':
        'Teaching-level parsing of uncompressed / common transfer syntaxes only (explicit and implicit VR little endian); bundled data are seeded simulated phantoms, not clinical images, and are not for clinical image diagnosis.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:b4c5b02139f0dd386dde3b8fe91cf966',
    sig: 'a3d5d10d24346a630419c8e82d73bb98e232a9c4e9e48863bd97a2d26cfbf765b0089ebd105b622cbb643efb2ff989c7e2cd7f5af89b2ba2ef73b4e4ae9a0b01',
    signer: 'Ergalics Studio (med pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '25f660c62a9e6bb7d3108bb59667b99d49f7fa2a60df6308361226303a751e55',
  },
  formats: [
    {
      extension: '.dcm',
      mimeTypes: ['application/dicom'],
      description: 'DICOM Part-10 single slice, or several Part-10 files concatenated into one stack',
    },
    {
      extension: '.ima',
      mimeTypes: ['application/dicom'],
      description: 'DICOM Part-10 slice(s), same handling as .dcm',
    },
  ],
};
