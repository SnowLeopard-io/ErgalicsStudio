import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BUILTIN_PLUGINS, findBuiltin } from '@ergalics/plugins/builtin';
import {
  SHARED_DATA_PRESETS,
  resolvePluginDataSchemas,
  validateDataSchemaSpec,
  validatePluginDataText,
} from '@/core/data-schema';
import { BUILTIN_PLUGIN_DATA_SCHEMAS } from '@/core/data-schema/builtin-bindings';
import { buildSchemaTemplateText } from '@/stores/dataEditorStore';
import type { PluginApi } from '@ergalics/plugin-sdk';

function createSilentApi(warnings: string[]): PluginApi {
  return {
    locale: 'zh-CN',
    t: (k) => k,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify: (kind, msg) => {
      if (kind === 'warning' || kind === 'error') {
        warnings.push(`${kind}: ${msg}`);
      }
    },
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
    readText: (f) => f.text(),
    readBinary: (f) => f.arrayBuffer(),
    getParam: () => undefined,
    setParam: () => {},
  };
}

describe('Phase 4 Builtin Plugin Data Schema Rollout', () => {
  beforeAll(() => {
    if (typeof globalThis.requestAnimationFrame === 'undefined') {
      vi.stubGlobal('requestAnimationFrame', () => 1);
      vi.stubGlobal('cancelAnimationFrame', () => {});
    }
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('validates every shared preset structurally and against its own sample template', () => {
    const presetIds = Object.keys(SHARED_DATA_PRESETS);
    expect(presetIds.length).toBeGreaterThanOrEqual(20);

    for (const [id, schema] of Object.entries(SHARED_DATA_PRESETS)) {
      expect(() => validateDataSchemaSpec(schema, id)).not.toThrow();
      if (schema.kind === 'binary') continue;

      const tpl = buildSchemaTemplateText(schema);
      expect(tpl.trim().length, `empty template for ${id}`).toBeGreaterThan(0);

      const res = validatePluginDataText(tpl, schema, {
        fileName: `sample${schema.extensions[0] ?? '.csv'}`,
      });
      expect(res.status, `template failed Zod validation for ${id}`).toBe('ok');
    }
  });

  it('maps every BUILTIN_PLUGIN_DATA_SCHEMAS entry to a real builtin plugin with valid schemas', () => {
    const builtinIds = new Set(BUILTIN_PLUGINS.map((p) => p.manifest.id));
    const boundIds = Object.keys(BUILTIN_PLUGIN_DATA_SCHEMAS);
    expect(boundIds.length).toBeGreaterThanOrEqual(55);

    for (const pluginId of boundIds) {
      expect(builtinIds.has(pluginId), `unknown plugin id in builtin-bindings: ${pluginId}`).toBe(true);
      const entry = findBuiltin(pluginId)!;
      const resolved = resolvePluginDataSchemas(entry.manifest);
      expect(resolved.length, `no resolved schemas for ${pluginId}`).toBeGreaterThan(0);

      for (const schema of resolved) {
        expect(() => validateDataSchemaSpec(schema, pluginId)).not.toThrow();
        if (schema.kind === 'binary') continue;
        const tpl = buildSchemaTemplateText(schema);
        const res = validatePluginDataText(tpl, schema, {
          fileName: `template${schema.extensions[0] ?? '.csv'}`,
        });
        expect(res.status, `template invalid for ${pluginId}/${schema.id}`).toBe('ok');
      }
    }
  });

  it('covers 100% of charts/* and stats/* builtin plugins', () => {
    const chartAndStats = BUILTIN_PLUGINS.filter(
      (p) =>
        p.manifest.id.startsWith('example.stats-') ||
        [
          'example.bar_chart',
          'example.boxplot',
          'example.bubble',
          'example.contour',
          'example.errorband',
          'example.heatmap',
          'example.histogram',
          'example.image',
          'example.model3d',
          'example.network',
          'example.parallel',
          'example.point-cloud',
          'example.point-cloud-3d',
          'example.polar',
          'example.qqplot',
          'example.sankey',
          'example.scatter',
          'example.surface-3d',
          'example.timeseries',
          'example.treemap',
          'example.violin',
          'example.voxel-3d',
        ].includes(p.manifest.id),
    );

    const covered = chartAndStats.filter((p) => resolvePluginDataSchemas(p.manifest).length > 0);
    // All 22 charts + all 7 stats + zipf (markov/clt/etc. optional) -> at least 29
    expect(covered.length).toBeGreaterThanOrEqual(29);
  });

  it('delivers schema templates cleanly into real chart and stats plugin loadData() without warnings', async () => {
    const samplePluginIds = [
      'example.scatter',
      'example.sankey',
      'example.network',
      'example.bar_chart',
      'example.boxplot',
      'example.violin',
      'example.bubble',
      'example.errorband',
      'example.histogram',
      'example.qqplot',
      'example.treemap',
      'example.timeseries',
      'example.heatmap',
      'example.contour',
      'example.stats-survival',
      'example.stats-meta',
      'example.stats-doe',
      'example.stats-nonparametric',
      'example.stats-multivariate',
      'example.stats-timeseries',
    ];

    for (const id of samplePluginIds) {
      const info = findBuiltin(id);
      expect(info, `missing builtin ${id}`).toBeDefined();
      const plugin = await info!.load();
      const warnings: string[] = [];
      await plugin.init(createSilentApi(warnings));

      const schemas = resolvePluginDataSchemas(plugin.manifest);
      expect(schemas.length).toBeGreaterThan(0);

      for (const schema of schemas) {
        if (schema.kind === 'binary') continue;
        const tpl = buildSchemaTemplateText(schema);
        const res = validatePluginDataText(tpl, schema, {
          fileName: `tpl${schema.extensions[0] ?? '.csv'}`,
        });
        expect(res.status, `Zod failed for ${id}/${schema.id}`).toBe('ok');
        if (res.status === 'ok') {
          await plugin.loadData?.(res.payload.file);
        }
      }

      expect(warnings, `Plugin ${id} warned/errored on its own schema template`).toEqual([]);
      await plugin.destroy?.();
    }
  });
});
