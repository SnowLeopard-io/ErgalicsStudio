// ==========================================================================
// Regression: website marketplace downloads must install & run in the
// workstation (the "unsigned + empty right panel" bug).
//
// The website builds .cspkg archives client-side (website/src/cspkg-build.ts)
// with a mirrored copy of the FR-05 canonicalization (website/src/plugin-sign.ts).
// These tests close the loop end-to-end in Node: a package built by the
// website builder is parsed by the workstation loader, its signature verifies
// against the workstation's built-in trusted keys (no trust override), and the
// resulting plugin is genuinely functional — it exposes parameter controls and
// renders to a canvas, so the right panel is never empty after install.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { buildCspkg, marketplacePackageId } from '../../website/src/cspkg-build';
import { inspectCspkg, loadCspkg } from '@/core/cspkg';
import { TRUSTED_KEYS } from '@/core/plugin-signing';
import type { PluginApi } from '@/types/plugin';

const CATALOG_ID = 'example.fluid'; // collides with a built-in id on purpose

function makePackage() {
  return buildCspkg({
    id: CATALOG_ID,
    name: 'Lattice-Boltzmann Fluid',
    version: '2.0.1',
    author: 'Ergalics Official',
    description: 'GPU-accelerated 2-D incompressible flow.',
  });
}

/** Minimal canvas2d surface good enough to drive the demo plugin's render loop. */
function fakeCanvas() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (typeof prop === 'string') calls.push(prop);
        return () => undefined;
      },
      set: () => true,
    },
  );
  return {
    width: 300,
    height: 150,
    getContext: () => ctx,
    _calls: calls,
  } as unknown as HTMLCanvasElement & { _calls: string[] };
}

describe('website-built .cspkg → workstation install', () => {
  it('namespaces the id so it can never collide with a built-in', () => {
    expect(marketplacePackageId(CATALOG_ID)).toBe('market.example.fluid');
    expect(marketplacePackageId('market.x')).toBe('market.x');
  });

  it('signature verifies against the built-in trusted keys (no override)', async () => {
    const blob = makePackage();
    const buffer = await blob.arrayBuffer();
    const inspected = await inspectCspkg(buffer);
    expect(inspected.manifest.id).toBe('market.example.fluid');
    expect(inspected.signature.ok).toBe(true);
    expect(inspected.signature.fingerprint).toBeDefined();
    expect(TRUSTED_KEYS.some((k) => k.fingerprint === inspected.signature.fingerprint)).toBe(true);
  });

  it('installs without trustUnsigned and yields a functional plugin', async () => {
    const blob = makePackage();
    const file = new File([blob], 'market.example.fluid.cspkg');
    // No Worker in the node env → the loader falls back to legacy evaluation,
    // which exercises the exact same entry source the worker would run.
    const { plugin, mode } = await loadCspkg(
      file,
      () => ({ setStatus: () => undefined }) as unknown as PluginApi,
      { source: 'marketplace' },
    );
    expect(['isolated', 'legacy-fallback']).toContain(mode);

    // Right panel would be populated: real parameter controls exist.
    const params = await plugin.getParams();
    expect(params.length).toBeGreaterThan(0);
    expect(params.map((p) => p.key)).toEqual(['speed', 'hue', 'label']);

    // The plugin actually renders (canvas2d draw calls happen) and reacts to
    // parameter edits — the old stub did neither.
    const canvas = fakeCanvas();
    await plugin.render!({ canvas2d: canvas, dom: null as unknown as HTMLDivElement, reportDataScale: () => undefined });
    expect(canvas._calls).toContain('fillRect');
    expect(canvas._calls).toContain('fillText');

    await plugin.updateParams!({ speed: 2, label: 'hello' } as never);
    const after = await plugin.getParams();
    expect((after[0] as { value: number }).value).toBe(2);
    expect((after[2] as { value: string }).value).toBe('hello');

    await plugin.deactivate?.();
    await plugin.destroy?.();
  });
});
