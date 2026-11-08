// Regression test: conditional param visibility in the engineering plugins.
// Simulates the panel flow — getParams() → updateParams({key}) → getParams() —
// and asserts that controls whose visibleWhen rule excludes the current
// controlling value are hidden (isParamVisible === false).
import { describe, expect, it } from 'vitest';
import { isParamVisible, type ParamDefinition, type ParamVisibility } from '@/types/plugin';

import EngFluid from '@/plugins/builtin/engineering/fluid-mech/plugin';
import EngVibration from '@/plugins/builtin/engineering/vibration/plugin';
import EngHeat from '@/plugins/builtin/engineering/heat-transfer/plugin';
import EngMechanism from '@/plugins/builtin/engineering/mechanism/plugin';

interface PluginLike {
  getParams(): ParamDefinition[] | Promise<ParamDefinition[]>;
  updateParams(params: Record<string, unknown>): unknown;
}

async function defs(p: PluginLike): Promise<ParamDefinition[]> {
  return Promise.resolve(p.getParams());
}

function hiddenKeys(params: ParamDefinition[]): string[] {
  return params.filter((d) => !isParamVisible(d, params)).map((d) => d.key);
}

function modeRules(d: ParamDefinition): ParamVisibility[] {
  if (!d.visibleWhen) return [];
  const rules = Array.isArray(d.visibleWhen) ? d.visibleWhen : [d.visibleWhen];
  return rules.flatMap((r) => {
    const single = Array.isArray(r) ? r : [r];
    return single.filter((x) => (x as ParamVisibility).key === 'mode') as ParamVisibility[];
  });
}

/** Generic invariant: a control gated on `mode in [...]` must be hidden when
 *  the current mode is not in that list (top-level OR semantics). */
async function assertModeGating(p: PluginLike, modes: string[]): Promise<void> {
  for (const mode of modes) {
    await p.updateParams({ mode });
    const params = await defs(p);
    const hidden = hiddenKeys(params);
    for (const d of params) {
      const rules = modeRules(d);
      if (rules.length === 0) continue;
      // Top-level rules are OR-ed; the control is visible only if some rule
      // admits the current mode (or the rule carries no mode constraint).
      const admitted = rules.some((r) => !r.in || r.in.includes(mode));
      if (!admitted) {
        expect(hidden, `key ${d.key} must be hidden in mode ${mode}`).toContain(d.key);
      }
    }
  }
}

describe('engineering plugins: conditional visibility after a mode switch', () => {
  it('fluid-mech hides mode-foreign controls in every mode', async () => {
    const p = EngFluid() as unknown as PluginLike;
    await assertModeGating(p, ['pipe', 'bernoulli', 'bl', 'stream']);
    // Specific: viscosity is unused in the ideal Bernoulli mode.
    await p.updateParams({ mode: 'bernoulli' });
    expect(hiddenKeys(await defs(p))).toContain('mu');
    await p.updateParams({ mode: 'pipe' });
    expect(hiddenKeys(await defs(p))).not.toContain('mu');
  });

  it('vibration hides mode-foreign controls in every mode', async () => {
    const p = EngVibration() as unknown as PluginLike;
    await assertModeGating(p, ['sdof', 'mdof', 'frf', 'unbalance']);
  });

  it('mechanism hides mode-foreign controls in every mode', async () => {
    const p = EngMechanism() as unknown as PluginLike;
    const initial = await defs(p);
    const modeDef = initial.find((d) => d.key === 'mode') ?? initial.find((d) => d.type === 'select');
    expect(modeDef).toBeTruthy();
    const values = modeDef && modeDef.type === 'select' ? modeDef.options.map((o) => o.value) : [];
    await assertModeGating(p, values);
  });

  it('heat-transfer hides mode-foreign controls in every mode', async () => {
    const p = EngHeat() as unknown as PluginLike;
    const initial = await defs(p);
    const modeDef = initial.find((d) => d.key === 'mode');
    expect(modeDef, 'mode select must exist').toBeTruthy();
    const values = modeDef && modeDef.type === 'select' ? modeDef.options.map((o) => o.value) : [];
    expect(values.length).toBeGreaterThan(0);
    await assertModeGating(p, values);
    // AND semantics: tL applies to conduction mode with a Dirichlet left edge.
    // In convection mode it must be hidden even though edgeL may be 'dirichlet'
    // (this is the regression: the old OR-list leaked it into every mode).
    await p.updateParams({ mode: 'convection', edgeL: 'dirichlet' });
    expect(hiddenKeys(await defs(p))).toContain('tL');
    await p.updateParams({ mode: 'conduction', edgeL: 'dirichlet' });
    expect(hiddenKeys(await defs(p))).not.toContain('tL');
    await p.updateParams({ mode: 'conduction', edgeL: 'insulated' });
    expect(hiddenKeys(await defs(p))).toContain('tL');
  });
});
