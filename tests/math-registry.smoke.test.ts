import { describe, it, expect } from 'vitest';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';

const MATH_IDS = [
  'example.math-linalg',
  'example.math-dist',
  'example.math-numerics',
  'example.math-graph',
  'example.math-topology',
  'example.math-game',
];

describe('math plugin registry smoke', () => {
  it('registers and instantiates every new math plugin', async () => {
    for (const id of MATH_IDS) {
      const info = BUILTIN_PLUGINS.find((p) => p.manifest.id === id);
      expect(info, id).toBeTruthy();
      const plugin = await info!.load();
      expect(plugin.manifest.id, id).toBe(id);
      expect(typeof plugin.render, id).toBe('function');
      expect(plugin.getParams().length, id).toBeGreaterThan(0);
    }
  });
});
