// ==========================================================================
// Ergalics Studio plugin — starter entry
//
// The host executes the BUILT file (package/dist/index.js) as a function
// body: `new Function('api', source)`. Therefore:
//   - no `import` / `export` statements anywhere in this file (the build
//     compiles in script mode — see tsconfig.json);
//   - `api` below is the host-provided parameter (a bare `var` declaration
//     is emitted, which binds to it without clobbering);
//   - the emitted body ends with `return plugin;` (appended by build.mjs),
//     handing the host an object that implements the `Plugin` contract.
//
// Contract types live in ../sdk.d.ts (global, ambient).
// ==========================================================================

/** Bound to the host-provided `api` parameter at runtime. */
let api: PluginApi;

const manifest: PluginManifest = {
  id: 'com.example.starter',
  name: 'Starter Plugin',
  nameI18n: { 'zh-CN': '入门插件', 'en-US': 'Starter Plugin' },
  version: '0.1.0',
  author: 'Your Name',
  description: 'A minimal Ergalics Studio plugin.',
  descriptionI18n: {
    'zh-CN': '一个最小的 Ergalics Studio 插件示例。',
    'en-US': 'A minimal Ergalics Studio plugin example.',
  },
  license: 'MIT',
  entry: 'dist/index.js',
  category: 'utility',
  // sandbox omitted = "isolated" (recommended for third-party packages)
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'Comma-separated values' },
  ],
};

// ---- Plugin state ----

interface State {
  count: number;
  showLabel: boolean;
}

const state: State = { count: 50, showLabel: true };

// ---- Parameter panel (the host renders these into the right-hand panel) ----

function params(): ParamDefinition[] {
  return [
    {
      key: 'count',
      label: 'Points',
      labelI18n: { 'zh-CN': '点数', 'en-US': 'Points' },
      type: 'range',
      min: 1,
      max: 200,
      step: 1,
      value: state.count,
    },
    {
      key: 'showLabel',
      label: 'Show label',
      labelI18n: { 'zh-CN': '显示文字', 'en-US': 'Show label' },
      type: 'checkbox',
      value: state.showLabel,
    },
    {
      key: 'reset',
      label: 'Reset',
      labelI18n: { 'zh-CN': '重置', 'en-US': 'Reset' },
      type: 'button',
      variant: 'default',
      action: 'reset',
    },
  ];
}

// ---- Drawing ----

function draw(container: ContainerCapabilities): void {
  const canvas = container.canvas2d;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < state.count; i++) {
    const t = i / Math.max(1, state.count - 1);
    const x = 40 + t * (w - 80);
    const y = h / 2 + Math.sin(t * Math.PI * 4) * (h / 4);
    const hue = (i * 7) % 360;
    ctx.fillStyle = 'hsl(' + hue + ', 65%, 60%)';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (state.showLabel) {
    const label = api.locale === 'zh-CN' ? '点数：' + state.count : 'Points: ' + state.count;
    ctx.fillStyle = '#e6edf3';
    ctx.font = '16px sans-serif';
    ctx.fillText(label, 16, 28);
  }

  container.reportDataScale(state.count);
}

// ---- Plugin object (returned to the host by the built entry) ----

const plugin: ErgalicsPlugin = {
  manifest: manifest,

  init: function (a: PluginApi) {
    api = a;
    api.log('info', 'starter plugin initialized');
  },

  getParams: function (): ParamDefinition[] {
    return params();
  },

  // Sandbox caveat: getParam/setParam resolve as Promises across the RPC
  // bridge — always await them.
  activate: async function (context: PluginRenderContext) {
    const saved = (await context.api.getParam('count')) as number | undefined;
    if (typeof saved === 'number') state.count = saved;
  },

  render: function (container: ContainerCapabilities) {
    draw(container);
  },

  updateParams: async function (p: Record<string, unknown>) {
    if (typeof p.count === 'number') state.count = p.count;
    if (typeof p.showLabel === 'boolean') state.showLabel = p.showLabel;
    if (p.reset === true) {
      state.count = 50;
      state.showLabel = true;
      api.notify('info', 'reset done');
    }
    await api.setParam('count', state.count);
  },

  destroy: function () {
    // Release timers / GPU buffers here. Buffers from api.gpu.createBuffer
    // MUST be destroyed individually or device memory leaks.
  },
};
