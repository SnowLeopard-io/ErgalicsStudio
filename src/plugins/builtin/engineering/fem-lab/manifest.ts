// ==========================================================================
// fem-lab — finite element laboratory plugin manifest.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const femLabManifest: PluginManifest = {
  id: 'example.fem-lab',
  name: 'FEM Lab（有限元实验室）',
  version: '1.0.0',
  author: 'ergalics-studio',
  description:
    'Built-in finite element framework playground: Delaunay meshing of parametric 2-D domains, P1 assembly and conjugate-gradient solves for Poisson, transient heat and plane elasticity problems, with field-colour canvas output, deformed-shape overlay and analytic convergence benchmarks.',
  license: 'MIT',
  icon: '△',
  entry: 'example.fem-lab',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: {
      length: 'm',
      temperature: 'K',
      displacement: 'm',
      stress: 'Pa',
    },
    benchmarks: [
      'poisson-sine-L2-order≈2',
      'uniaxial-bar-exact-displacement',
      'heat-sine-decay-analytic',
      'heat-insulated-energy-conservation',
    ],
    reproducible: true,
    notes:
      'Deterministic meshing (seeded jitter grid + Bowyer–Watson + boundary recovery). Kernels are pure TypeScript with zero DOM in src/core/fem.',
  },
};
