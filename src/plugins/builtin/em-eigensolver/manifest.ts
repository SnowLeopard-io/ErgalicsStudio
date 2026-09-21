// Manifest-only module (B1: keeps `three` out of the startup graph).
// `builtin/index.ts` imports this file statically; the implementation in
// `plugin.ts` (which reaches `render3d.ts` → three) is loaded dynamically.
import type { PluginManifest } from '@/types/plugin';

export const emEigensolverManifest: PluginManifest = {
  id: 'example.em-eigensolver',
  name: 'EM Eigensolver',
  nameI18n: { 'zh-CN': '电磁谐振特征值求解器', 'en-US': 'EM Eigensolver' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Sparse Hermitian (indefinite) eigenpairs via thick-restart Lanczos, block LOBPCG and Jacobi-Davidson with MINRES shift-invert.',
  descriptionI18n: {
    'zh-CN':
      '面向电磁谐振/微波器件仿真的十万阶非正定厄密稀疏矩阵特征值求解器：厚重启 Lanczos、块 LOBPCG、Jacobi-Davidson 三内核 + MINRES 位移逆变换。',
    'en-US':
      'Large-scale sparse Hermitian (indefinite) eigenpairs via thick-restart Lanczos, block LOBPCG and Jacobi-Davidson with MINRES shift-invert.',
  },
  license: 'MIT',
  entry: 'example.em-eigensolver',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.npz', mimeTypes: ['application/zip', 'application/octet-stream'], description: 'NumPy sparse/dense matrix archive' },
    { extension: '.npy', mimeTypes: ['application/octet-stream'], description: 'NumPy dense matrix' },
    { extension: '.mtx', mimeTypes: ['text/plain'], description: 'Matrix Market coordinate file' },
  ],
};
