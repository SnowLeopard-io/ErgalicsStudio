// ==========================================================================
// Built-in plugin parameter metadata invariants.
//
// A param panel can only be usable if the metadata it renders is coherent:
//   - range: min < max, step > 0, value inside [min, max]
//   - select: non-empty options, current value exists among them
//   - number: finite value inside optional [min, max]
//   - visibleWhen: every controller key actually exists in getParams()
//
// Regressions here are invisible in unit tests of the kernels but show up as
// "the slider cannot move" / "the dropdown is empty" in the UI, so this walks
// every bundled plugin once.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { isParamVisible, type ParamDefinition, type PluginApi } from '@/types/plugin';

function fakeApi(): PluginApi {
  return {
    locale: 'en-US',
    t: (k: string) => k,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify: () => {},
    log: () => {},
    exportFile: () => {},
    cache: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
      clear: async () => {},
      keys: async () => [],
    },
    openFile: async () => null,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    getParam: () => undefined,
    setParam: () => {},
  };
}

/** Collect `visibleWhen` controller keys, including `all:` chains. */
function controllerKeys(cond: ParamDefinition['visibleWhen']): string[] {
  if (!cond) return [];
  const rules = Array.isArray(cond) ? cond : [cond];
  const keys: string[] = [];
  for (const rule of rules) {
    if (typeof rule.key === 'string') keys.push(rule.key);
    for (const nested of rule.all ?? []) {
      if (typeof (nested as { key?: unknown }).key === 'string') {
        keys.push((nested as { key: string }).key);
      }
    }
  }
  return keys;
}

describe('built-in plugin parameter metadata', () => {
  it('every bundled plugin exposes coherent params', async () => {
    const problems: string[] = [];

    for (const entry of BUILTIN_PLUGINS) {
      const id = entry.manifest.id;
      const plugin = await entry.load();
      await plugin.init(fakeApi());
      const defs = (await plugin.getParams?.()) ?? [];
      const byKey = new Map(defs.map((d) => [d.key, d]));

      for (const d of defs) {
        const where = `${id}/${d.key}`;
        const hidden = !isParamVisible(d, defs);

        if (d.type === 'range') {
          if (!Number.isFinite(d.min) || !Number.isFinite(d.max)) {
            problems.push(`${where}: range min/max not finite`);
          } else if (!(d.max > d.min)) {
            problems.push(`${where}: range max(${d.max}) <= min(${d.min})`);
          }
          if (!(d.step > 0)) problems.push(`${where}: range step=${d.step}`);
          if (!Number.isFinite(d.value)) {
            problems.push(`${where}: range value not finite (${d.value})`);
          } else if (d.value < d.min - 1e-9 || d.value > d.max + 1e-9) {
            problems.push(`${where}: range value=${d.value} outside [${d.min}, ${d.max}]`);
          }
        } else if (d.type === 'select') {
          if (d.options.length === 0) {
            problems.push(`${where}: select has no options`);
          } else if (
            !d.options.some((o) => String(o.value) === String(d.value)) &&
            !hidden
          ) {
            // A hidden control may hold a sentinel (e.g. mechanism's
            // trainKind='none' when not in gear mode); a visible one may not.
            problems.push(
              `${where}: select value='${d.value}' not in [${d.options.map((o) => o.value).join(',')}]`,
            );
          }
        } else if (d.type === 'number') {
          if (!Number.isFinite(d.value)) problems.push(`${where}: number value not finite`);
          if (d.min !== undefined && d.value < d.min - 1e-9) {
            problems.push(`${where}: number value=${d.value} < min=${d.min}`);
          }
          if (d.max !== undefined && d.value > d.max + 1e-9) {
            problems.push(`${where}: number value=${d.value} > max=${d.max}`);
          }
        }

        for (const key of controllerKeys(d.visibleWhen)) {
          const controller = byKey.get(key);
          if (!controller) {
            problems.push(`${where}: visibleWhen controller '${key}' missing from getParams`);
          } else if (!('value' in controller)) {
            problems.push(`${where}: visibleWhen controller '${key}' has no value`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  }, 120_000);
});
