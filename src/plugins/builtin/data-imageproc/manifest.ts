import type { PluginManifest } from '@/types/plugin';

export const dataImageprocManifest: PluginManifest = {
  id: 'example.data-imageproc',
  name: 'Image Processing',
  nameI18n: { 'zh-CN': '图像处理', 'en-US': 'Image Processing' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Self-implemented image-processing numerics: radix-2 2-D FFT, spatial & spectral convolution, separable Gaussian blur, unsharp sharpening, Sobel edges, histogram equalisation and PSNR/MSE quality metrics, all validated against an embedded numerics benchmark.',
  descriptionI18n: {
    'zh-CN':
      '自实现的图像处理数值内核：基-2 二维 FFT、空间/频域卷积、可分离高斯模糊、unsharp 锐化、Sobel 边缘、直方图均衡与 PSNR/MSE 质量指标，并附带内嵌数值基准验证。',
    'en-US':
      'Self-implemented image-processing numerics: radix-2 2-D FFT, spatial & spectral convolution, separable Gaussian blur, unsharp sharpening, Sobel edges, histogram equalisation and PSNR/MSE quality metrics, validated by an embedded numerics benchmark.',
  },
  license: 'MIT',
  entry: 'example.data-imageproc',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { pixel: '8bit', psnr: 'dB', time: 'ms' },
    benchmarks: ['imageproc-numerics-benchmark'],
    reproducible: true,
    notes:
      'Embedded benchmark: (1) 2-D FFT vs naive O(N⁴) DFT on a seeded 32×32 real matrix, max complex error < 1e-9; (2) convolution theorem, spatial convolution vs spectral product < 1e-6; (3) histogram-equalisation flattening, 16-bin grey-range frequency variance strictly decreases; (4) PSNR ⇔ MSE identity PSNR = 10·log10(MAX²/MSE), error 0. FFT inputs are padded to power-of-two sizes by edge (replicate) extension so borders do not add artificial high frequencies. The built-in subject image is program-generated (gradient + disc + stripes + seeded gaussian noise), so every result is reproducible.',
    notesI18n: {
      'zh-CN':
        '内嵌基准（统一相对误差口径）：① 种子化 32×32 实矩阵上二维 FFT 与朴素 O(N⁴) DFT 逐复数最大差 < 1e-9；② 卷积定理：空间卷积与频域乘积逆变换最大差 < 1e-6；③ 直方图均衡使 16 级灰度区间的频率方差严格下降；④ PSNR 与 MSE 的解析恒等式 PSNR=10·log10(MAX²/MSE) 误差为 0。FFT 输入按边缘复制延拓补齐到 2 的幂，避免边界引入伪高频。内置测试图由程序生成（渐变+圆盘+条纹+固定种子高斯噪声），全部结果可复现。',
      'en-US':
        'Embedded benchmark (unified relative-error convention): (1) 2-D FFT vs naive O(N⁴) DFT on a seeded 32×32 real matrix, max complex error < 1e-9; (2) convolution theorem, spatial convolution vs spectral product < 1e-6; (3) histogram equalisation strictly decreases the 16-bin grey-range frequency variance; (4) PSNR ⇔ MSE identity PSNR = 10·log10(MAX²/MSE) with zero error. FFT inputs are padded to power-of-two sizes by edge (replicate) extension. The built-in subject is program-generated (gradient + disc + stripes + seeded gaussian noise); every result is reproducible.',
    },
  },
};
