// ==========================================================================
// Ergalics Studio — built-in host tools for the assistant agent
//
// These are the app's "operable components". Instead of letting the model
// emit arbitrary DOM/JS (impossible to verify, trivial to abuse), each host
// capability is published as one declarative tool with a JSON Schema:
//
//   list_plugins / activate_plugin        — plugin registry navigation
//   get_plugin_params / set_plugin_params — the right-hand parameter panel
//   press_plugin_action                   — Start / Stop / benchmark buttons
//   get_canvas_snapshot                   — what the viewport actually shows
//   list_data_files / read_data_file      — project + bundled datasets
//   get_science_outputs                   — published numerical conclusions
//   run_code                              — the active editor's runtime
//   notify_user                           — say something in the transcript
//
// Every handler returns MCP content blocks, so a future external MCP server
// can be swapped in without touching the agent loop.
// ==========================================================================

import { usePluginStore, getHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { getScienceOutputs } from '@/core/research/scienceOutput';
import { listDataFiles, listProjectFiles, resolveDataFile } from '@/core/dataFiles';
import { emit } from '@/core/events';
import type { ParamDefinition, PluginRegistryEntry } from '@/types/plugin';
import type { RegisteredTool, ToolResult } from './types';
import { errorResult, textResult, textWithImage } from './types';

/** Cap on a single data-file read so a huge CSV cannot blow the context. */
const MAX_FILE_CHARS = 12000;
/** Default/largest preview line counts for read_data_file. */
const MAX_PREVIEW_LINES = 200;

function hostTool(
  name: string,
  description: string,
  inputSchema: RegisteredTool['definition']['inputSchema'],
  handler: RegisteredTool['handler'],
  title?: string,
): RegisteredTool {
  return { definition: { name, description, inputSchema, title, source: 'host' }, handler };
}

function pluginSummary(entry: PluginRegistryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description.trim().split(/\r?\n/)[0]?.slice(0, 160) ?? '',
    loaded: entry.loaded,
    active: entry.active,
    ...(entry.formats.length > 0 ? { formats: entry.formats.map((f) => f.extension) } : {}),
  };
}

function findEntry(id: string): PluginRegistryEntry | undefined {
  return usePluginStore.getState().registry.find((e) => e.id === id);
}

/** Strip runtime-only fields from a param definition before showing the model. */
function paramSummary(def: ParamDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = { key: def.key, type: def.type, label: def.label };
  if (def.labelI18n) base.labelI18n = def.labelI18n;
  if (def.hint) base.hint = def.hint;
  if ('value' in def) base.value = def.value;
  switch (def.type) {
    case 'range':
      base.min = def.min;
      base.max = def.max;
      base.step = def.step;
      break;
    case 'select':
      base.options = def.options.map((o) => ({ value: o.value, label: o.label }));
      break;
    case 'number':
      base.min = def.min;
      base.max = def.max;
      base.step = def.step;
      break;
    case 'button':
      base.action = def.action ?? def.key;
      break;
    default:
      break;
  }
  return base;
}

// ---- registry / navigation -------------------------------------------------

const listPlugins = hostTool(
  'list_plugins',
  'List the scientific tool plugins available in this workspace with their ids, names, whether each is loaded and which one is currently active. Call this first whenever the user names a topic rather than an exact plugin id.',
  { type: 'object', properties: {} },
  () => {
    const { registry, activeId } = usePluginStore.getState();
    return textResult(
      JSON.stringify({ activePluginId: activeId, plugins: registry.map(pluginSummary) }, null, 2),
    );
  },
  'List plugins',
);

const activatePlugin = hostTool(
  'activate_plugin',
  'Activate (switch the main viewport to) a plugin by id. Loading happens automatically for built-in plugins. Returns the new plugin\'s parameter definitions so a following set_plugin_params can target real keys.',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Exact plugin id from list_plugins, e.g. "example.psych-rt".' },
    },
    required: ['pluginId'],
  },
  async (args) => {
    const id = String(args.pluginId ?? '');
    const entry = findEntry(id);
    if (!entry) return errorResult(`no plugin with id "${id}" — call list_plugins for valid ids`);
    try {
      await usePluginStore.getState().activate(id);
    } catch (err) {
      return errorResult(`failed to activate "${id}": ${err instanceof Error ? err.message : String(err)}`);
    }
    // Params must be read *after* activation: built-ins build their
    // definitions from live state inside getParams().
    const plugin = findEntry(id)?.plugin;
    let params: unknown[] = [];
    try {
      params = ((await plugin?.getParams?.()) ?? []).map(paramSummary);
    } catch {
      params = [];
    }
    return textResult(
      JSON.stringify(
        { activated: id, name: findEntry(id)?.name ?? id, parameters: params },
        null,
        2,
      ),
    );
  },
  'Activate plugin',
);

// ---- parameters ------------------------------------------------------------

const getPluginParams = hostTool(
  'get_plugin_params',
  'Read the parameter panel of a plugin: every control\'s key, type, current value and (for ranges/selects) its bounds or options. Defaults to the active plugin when pluginId is omitted.',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Plugin id; defaults to the active plugin.' },
    },
  },
  async (args) => {
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active — pass pluginId or activate one first');
    const entry = findEntry(id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);
    const defs = (await entry.plugin.getParams?.()) ?? [];
    return textResult(JSON.stringify({ pluginId: id, parameters: defs.map(paramSummary) }, null, 2));
  },
  'Read plugin parameters',
);

const setPluginParams = hostTool(
  'set_plugin_params',
  'Set one or more parameters of the active plugin, exactly as dragging a slider or picking a dropdown would. Values are dispatched through the same bus the parameter panel uses, so plugins recompute and repaint. Values for ranges/numbers are clamped by the plugin itself.',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Plugin id; defaults to the active plugin.' },
      params: {
        type: 'object',
        description:
          'Object of parameter key → new value, e.g. {"trialCount": 20, "mode": "single"}. Use get_plugin_params for valid keys and value types.',
      },
    },
    required: ['params'],
  },
  async (args) => {
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active — pass pluginId or activate one first');
    const params = args.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return errorResult('"params" must be an object of key → value');
    }
    const entry = findEntry(id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);
    // Reject keys the plugin does not declare: the bus drops unknown keys
    // silently, so without this check the model would believe a typo landed.
    const defs = (await entry.plugin.getParams?.()) ?? [];
    const known = new Map(defs.map((d) => [d.key, d]));
    const unknown: string[] = [];
    const delivered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      const def = known.get(key);
      if (!def || def.type === 'button') {
        unknown.push(key);
        continue;
      }
      delivered[key] = value;
    }
    if (unknown.length > 0) {
      return errorResult(
        `unknown or non-settable parameter(s) on ${id}: ${unknown.join(', ')}. ` +
          `Settable keys: ${defs
            .filter((d) => d.type !== 'button')
            .map((d) => d.key)
            .join(', ')}`,
      );
    }
    emit(`plugin:${id}:params`, delivered);
    return textResult(JSON.stringify({ applied: delivered, pluginId: id }));
  },
  'Set plugin parameters',
);

const pressPluginAction = hostTool(
  'press_plugin_action',
  'Press one of a plugin\'s action buttons (Run experiment, Stop, Clear data, benchmark, export…). Use get_plugin_params to find a button key; buttons are the parameters whose type is "button".',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Plugin id; defaults to the active plugin.' },
      action: { type: 'string', description: 'Button parameter key, e.g. "start" or "stop".' },
    },
    required: ['action'],
  },
  async (args) => {
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active');
    const entry = findEntry(id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);
    const action = String(args.action ?? '');
    const defs = (await entry.plugin.getParams?.()) ?? [];
    const button = defs.find((d) => d.type === 'button' && (d.action ?? d.key) === action);
    if (!button) {
      const available = defs.filter((d) => d.type === 'button').map((d) => d.action ?? d.key);
      return errorResult(
        `no button "${action}" on ${id}. Available actions: ${available.join(', ') || '(none)'}`,
      );
    }
    // Same payload the parameter panel emits for a button click.
    emit(`plugin:${id}:params`, { [action]: { action } });
    return textResult(`pressed "${action}" on ${id}`);
  },
  'Press plugin button',
);

// ---- viewport --------------------------------------------------------------

const getCanvasSnapshot = hostTool(
  'get_canvas_snapshot',
  'Capture what the main viewport currently shows as a PNG image. Use it to check the visual result of a parameter change, or when the user asks what is on screen. Requires the model configured in the assistant settings to accept images.',
  {
    type: 'object',
    properties: {
      transparent: {
        type: 'boolean',
        description: 'For 3-D scenes, drop the background and reference furniture (default false).',
        default: false,
      },
    },
  },
  (args) => {
    const containers = getHostContainers();
    if (!containers) return errorResult('the workbench viewport is not mounted');
    const transparent = args.transparent === true;
    // Re-render first: the plugin may have been asked to repaint and the
    // bitmap would otherwise lag one frame behind the state the model just set.
    rerenderActivePlugin();
    const three = containers.getThree?.();
    if (three?.isVisible()) {
      try {
        const url = three.snapshot(transparent ? { transparent: true } : undefined);
        return textWithImage(`3-D viewport snapshot${transparent ? ' (transparent background)' : ''}`, url);
      } catch (err) {
        return errorResult(`3-D snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const canvas = containers.canvas2d;
    if (!canvas) return errorResult('the 2-D canvas is unavailable');
    try {
      return textWithImage(`2-D viewport snapshot (${canvas.width}×${canvas.height})`, canvas.toDataURL('image/png'));
    } catch (err) {
      return errorResult(`canvas snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  'Canvas snapshot',
);

// ---- data ------------------------------------------------------------------

const listDataFilesTool = hostTool(
  'list_data_files',
  'List dataset names the workspace can load: files imported into the current project plus the bundled example datasets.',
  { type: 'object', properties: {} },
  () => {
    const project = listProjectFiles();
    const all = listDataFiles();
    const projectSet = new Set(project);
    return textResult(
      JSON.stringify(
        {
          projectFiles: project,
          exampleFiles: all.filter((n) => !projectSet.has(n)),
        },
        null,
        2,
      ),
    );
  },
  'List data files',
);

const readDataFileTool = hostTool(
  'read_data_file',
  'Read the beginning of a dataset as text (CSV/TSV/JSON…). Use it to discover column names and value ranges before suggesting an analysis. Output is truncated to keep the conversation within the model context.',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File name as returned by list_data_files.' },
      lines: {
        type: 'integer',
        description: `Number of leading lines to return (default 40, max ${MAX_PREVIEW_LINES}).`,
        minimum: 1,
        maximum: MAX_PREVIEW_LINES,
      },
    },
    required: ['path'],
  },
  async (args) => {
    const path = String(args.path ?? '');
    const text = await resolveDataFile(path);
    if (text === undefined) return errorResult(`no data file named "${path}"`);
    const limit = Math.min(
      MAX_PREVIEW_LINES,
      Math.max(1, Number.isInteger(args.lines) ? (args.lines as number) : 40),
    );
    const lines = text.split(/\r?\n/);
    const head = lines.slice(0, limit).join('\n');
    const truncated = lines.length > limit + 1 || head.length > MAX_FILE_CHARS;
    const body = head.length > MAX_FILE_CHARS ? head.slice(0, MAX_FILE_CHARS) : head;
    const header = `# ${path} — ${lines.length} line(s), showing ${Math.min(limit, lines.length)}`;
    return textResult(truncated ? `${header} (truncated)\n${body}` : `${header}\n${body}`);
  },
  'Read data file',
);

// ---- scientific outputs ----------------------------------------------------

const getScienceOutputsTool = hostTool(
  'get_science_outputs',
  'Read the numerical conclusions every plugin has published (R², confidence intervals, conservation diagnostics…). These are the app\'s computed results — prefer them over re-deriving numbers, and never invent a value that is not here.',
  { type: 'object', properties: {} },
  () => {
    const snap = getScienceOutputs();
    const entries = Object.values(snap).map((e) => ({
      pluginId: e.pluginId,
      metrics: e.metrics.map((m) => ({
        label: m.label,
        value: m.value,
        ...(m.unit ? { unit: m.unit } : {}),
        ...(m.severity ? { severity: m.severity } : {}),
        ...(m.hint ? { hint: m.hint } : {}),
      })),
    }));
    if (entries.length === 0) return textResult('no plugin has published scientific outputs yet');
    return textResult(JSON.stringify(entries, null, 2));
  },
  'Read scientific outputs',
);

// ---- execution -------------------------------------------------------------

const runCodeTool = hostTool(
  'run_code',
  'Run Python code with the studio.* API in the active editor\'s runtime (Pyodide) and return console output or the error. Only studio.* APIs exist: load, exampleData, select, summary, histogram, addColumn, plot, print, notify, filter, sort, normalize, topK, renameColumn, filterRange. Pass complete, runnable code — not a fragment.',
  {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Complete Python source using only documented studio.* calls.' },
    },
    required: ['code'],
  },
  async (args) => {
    const code = String(args.code ?? '');
    if (!code.trim()) return errorResult('"code" is empty');
    const run = useAiPanelStore.getState().runHandler;
    if (!run) {
      return errorResult(
        'no runnable editor is mounted — code execution needs the Code or Block view of a project file. Ask the user to open one, or answer analytically instead.',
      );
    }
    const result = await run(code);
    if (result.insertedOnly) {
      return errorResult('the code was only inserted into the workspace (no runtime available to execute it here)');
    }
    if (!result.ok) return errorResult(result.error ?? 'execution failed with no message');
    return textResult('code ran successfully; output appears in the editor console');
  },
  'Run code',
);

// ---- user-visible messages -------------------------------------------------

const notifyUserTool = hostTool(
  'notify_user',
  'Show a short toast notification in the app UI. Use it to report that a long action finished, not for ordinary conversation (plain assistant text already reaches the user).',
  {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['info', 'success', 'warning', 'error'], description: 'Severity (default info).' },
      message: { type: 'string', description: 'One short sentence.' },
    },
    required: ['message'],
  },
  (args) => {
    const kind = args.kind;
    const allowed = ['info', 'success', 'warning', 'error'] as const;
    const severity = allowed.includes(kind as (typeof allowed)[number])
      ? (kind as (typeof allowed)[number])
      : 'info';
    const message = String(args.message ?? '').slice(0, 300);
    if (!message) return errorResult('"message" is empty');
    useAppStore.getState().notify(severity, message);
    return textResult(`notified the user (${severity})`);
  },
  'Notify user',
);

/** Every built-in host tool, ready to register into a ToolRegistry. */
export const HOST_TOOLS: readonly RegisteredTool[] = [
  listPlugins,
  activatePlugin,
  getPluginParams,
  setPluginParams,
  pressPluginAction,
  getCanvasSnapshot,
  listDataFilesTool,
  readDataFileTool,
  getScienceOutputsTool,
  runCodeTool,
  notifyUserTool,
];

/** Register the built-ins into the process-wide registry (idempotent). */
export function registerHostTools(register: {
  registerAll: (tools: readonly RegisteredTool[]) => void;
}): void {
  register.registerAll(HOST_TOOLS);
}

export type { ToolResult };
