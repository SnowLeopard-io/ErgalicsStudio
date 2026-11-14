// ==========================================================================
// Host tool integration — do the assistant's tools actually operate the app?
//
// These tests drive the real store wiring (plugin activation, the parameter
// bus, the param panel payload shapes) with a probe plugin, so a refactor that
// silently breaks the assistant's ability to act shows up here rather than as
// "the AI stopped working" in the UI.
// ==========================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ParamDefinition, Plugin, PluginManifest } from '@/types/plugin';
import type { ToolResult } from '@/core/ai/tools/types';

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ project: null, setDirty: () => undefined }),
    setState: () => undefined,
  },
}));

const { usePluginStore, setHostContainers } = await import('@/stores/pluginStore');
const { HOST_TOOLS } = await import('@/core/ai/tools/hostTools');
const { ensureHostToolsRegistered, toolRegistry } = await import('@/core/ai/tools');
const { availableTools } = await import('@/core/ai/chat');

function manifest(id: string, name: string): PluginManifest {
  return { id, name, version: '1.0.0', author: 'test', description: `${name} description`, entry: id };
}

function probePlugin(id: string, name: string, applied: Record<string, unknown>[]): Plugin {
  const params: ParamDefinition[] = [
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 10, step: 1, value: 3 },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }], value: 'a' },
    { key: 'start', label: 'Start', type: 'button', action: 'start' },
  ];
  return {
    manifest: manifest(id, name),
    init: () => undefined,
    destroy: () => undefined,
    activate: () => undefined,
    deactivate: () => undefined,
    render: () => undefined,
    getParams: () => params,
    updateParams: (p: Record<string, unknown>) => {
      applied.push(p);
    },
  } as Plugin;
}

/** Call a host tool by name from the real registry. */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  ensureHostToolsRegistered();
  return toolRegistry.invoke(name, args, { allowed: undefined });
}

function textOf(result: ToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

beforeEach(async () => {
  setHostContainers({
    dom: {} as HTMLDivElement,
    canvas2d: {} as HTMLCanvasElement,
    reportDataScale: () => undefined,
  });
  await usePluginStore.getState().deactivate();
  for (const entry of usePluginStore.getState().registry) {
    await usePluginStore.getState().unload(entry.id);
  }
  usePluginStore.setState({ registry: [], activeId: null, runHistory: [], loadingIds: [] });
});

describe('host tools', () => {
  it('publishes every capability as an MCP-shaped descriptor', () => {
    const names = HOST_TOOLS.map((t) => t.definition.name).sort();
    expect(names).toEqual([
      'activate_plugin',
      'get_canvas_snapshot',
      'get_plugin_params',
      'get_science_outputs',
      'list_data_files',
      'list_plugins',
      'notify_user',
      'press_plugin_action',
      'read_data_file',
      'run_code',
      'set_plugin_params',
    ]);
    for (const tool of HOST_TOOLS) {
      expect(tool.definition.source).toBe('host');
      expect(tool.definition.description.length).toBeGreaterThan(20);
      expect(tool.definition.inputSchema.type).toBe('object');
    }
  });

  it('lists and activates plugins, returning the new parameter set', async () => {
    const applied: Record<string, unknown>[] = [];
    await usePluginStore.getState().load(probePlugin('example.a', 'Alpha', applied));
    await usePluginStore.getState().load(probePlugin('example.b', 'Beta', applied));

    const listed = JSON.parse(textOf(await callTool('list_plugins')));
    expect(listed.plugins.map((p: { id: string }) => p.id).sort()).toEqual(['example.a', 'example.b']);

    const activated = await callTool('activate_plugin', { pluginId: 'example.b' });
    expect(activated.isError).toBeFalsy();
    const payload = JSON.parse(textOf(activated));
    expect(payload.activated).toBe('example.b');
    expect(payload.parameters.map((p: { key: string }) => p.key)).toEqual(['size', 'mode', 'start']);
    expect(usePluginStore.getState().activeId).toBe('example.b');

    expect((await callTool('activate_plugin', { pluginId: 'nope' })).isError).toBe(true);
  });

  it('sets parameters through the same bus the panel uses', async () => {
    const applied: Record<string, unknown>[] = [];
    await usePluginStore.getState().load(probePlugin('example.a', 'Alpha', applied));
    await usePluginStore.getState().activate('example.a');

    const ok = await callTool('set_plugin_params', { params: { size: 7 } });
    expect(ok.isError).toBeFalsy();
    expect(applied.at(-1)).toEqual({ size: 7 });
  });

  it('rejects undeclared parameter keys so a typo never looks applied', async () => {
    const applied: Record<string, unknown>[] = [];
    await usePluginStore.getState().load(probePlugin('example.a', 'Alpha', applied));
    await usePluginStore.getState().activate('example.a');

    const bad = await callTool('set_plugin_params', { params: { siz: 7 } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('siz');
    expect(applied).toEqual([]);

    // a button key is not settable either — it must go through press_plugin_action
    expect((await callTool('set_plugin_params', { params: { start: true } })).isError).toBe(true);
  });

  it('presses a declared button and refuses an undeclared one', async () => {
    const applied: Record<string, unknown>[] = [];
    await usePluginStore.getState().load(probePlugin('example.a', 'Alpha', applied));
    await usePluginStore.getState().activate('example.a');

    const pressed = await callTool('press_plugin_action', { action: 'start' });
    expect(pressed.isError).toBeFalsy();
    // The panel emits `{ [key]: { action: key } }`; the plugin must see that.
    expect(applied.at(-1)).toEqual({ start: { action: 'start' } });

    const missing = await callTool('press_plugin_action', { action: 'clearData' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('start');
  });

  it('reads parameters of the active plugin without an explicit id', async () => {
    const applied: Record<string, unknown>[] = [];
    await usePluginStore.getState().load(probePlugin('example.a', 'Alpha', applied));
    await usePluginStore.getState().activate('example.a');

    const params = JSON.parse(textOf(await callTool('get_plugin_params')));
    expect(params.pluginId).toBe('example.a');
    const size = params.parameters.find((p: { key: string }) => p.key === 'size');
    expect(size).toMatchObject({ type: 'range', min: 1, max: 10, value: 3 });
  });

  it('captures the 2-D canvas as an image content block', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const canvas = { width: 800, height: 600, toDataURL: () => dataUrl } as unknown as HTMLCanvasElement;
    setHostContainers({ dom: {} as HTMLDivElement, canvas2d: canvas, reportDataScale: () => undefined });

    const shot = await callTool('get_canvas_snapshot');
    expect(shot.isError).toBeFalsy();
    expect(shot.content[0]).toEqual({ type: 'text', text: '2-D viewport snapshot (800×600)' });
    expect(shot.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' });
  });

  it('reports a missing run handler instead of pretending code ran', async () => {
    const run = await callTool('run_code', { code: 'print(1)' });
    expect(run.isError).toBe(true);
    expect(textOf(run)).toContain('no runnable editor');
  });

  it('publishes the tool list according to the operate/vision policy', () => {
    // localStorage is absent in the node environment → both flags default off.
    const names = availableTools().map((t) => t.name);
    expect(names).toContain('list_plugins');
    expect(names).not.toContain('set_plugin_params');
    expect(names).not.toContain('get_canvas_snapshot');
  });
  it('emits scientific outputs read by the assistant', async () => {
    const { setScienceOutputs } = await import('@/core/research/scienceOutput');
    setScienceOutputs('example.a', [{ key: 'r2', label: 'R²', value: '0.981' }]);
    const out = JSON.parse(textOf(await callTool('get_science_outputs')));
    expect(out[0].metrics[0]).toMatchObject({ label: 'R²', value: '0.981' });
  });
});
