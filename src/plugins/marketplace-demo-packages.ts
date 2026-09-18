// ==========================================================================
// Marketplace demo packages (FR-05)
//
// Two small signed .cspkg archives generated at module load from embedded
// community test keys. They make the marketplace's community entries
// actually installable end-to-end (signature → trust registry → sandbox)
// without shipping binary fixtures, and double as the reference example of
// what `scripts/sign-cspkg.mjs` produces.
// ==========================================================================

import { zipSync, strToU8 } from 'fflate';
import type { PluginManifest } from '@/types/plugin';
import { signPackage } from '@/core/plugin-signing';

/**
 * Test-only seeds. The *secrets* below are intentionally published: these
 * keys exist solely so the demo packages exercise the signed-install path
 * out of the box; the real official release secret never ships in the repo.
 */
const WORDCLOUD_SEED = 'e9c1c6182d7f078904a950489567f734bfbcdd240ef78427767185751d583935';
const AUDIO_SEED = 'fb2d3794dfca5dec189d1d4c8256ecebab4adb7d829fada0a059304b099702ba';

const WORDCLOUD_ENTRY = `
var manifest = {
  id: 'community.wordcloud', name: 'Word Cloud', version: '0.9.0',
  author: 'community', description: 'Generate a word cloud from pasted text.',
  entry: 'dist/index.js',
};
var api = null;
var text = 'data analysis science research plugin signing install sandbox canvas visualization statistics computation experiment reproducibility';
var params = [{ key: 'text', label: 'Source text', type: 'text', value: text, placeholder: 'Paste text to visualize' }];

function frequencies() {
  var words = (text.toLowerCase().match(/[a-z]{2,}/g)) || [];
  var freq = {};
  for (var i = 0; i < words.length; i++) { freq[words[i]] = (freq[words[i]] || 0) + 1; }
  return Object.keys(freq).map(function (w) { return { word: w, count: freq[w] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, 48);
}

function draw(canvas) {
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, w, h);
  var items = frequencies();
  var max = items.length ? items[0].count : 1;
  var cx = w / 2, cy = h / 2;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var size = Math.max(10, Math.round(34 * Math.sqrt(it.count / max)) + 4);
    ctx.font = size + 'px sans-serif';
    var angle = i * 2.399963;
    var radius = 8 + 7 * Math.sqrt(i) * (1 + size / 40);
    var x = cx + radius * Math.cos(angle) - ctx.measureText(it.word).width / 2;
    var y = cy + radius * Math.sin(angle) * 0.62 + size / 3;
    var hue = (i * 47) % 360;
    ctx.fillStyle = 'hsl(' + hue + ', 62%, ' + (58 + (i % 3) * 8) + '%)';
    ctx.fillText(it.word, x, y);
  }
}

return {
  manifest: manifest,
  init: function (a) { api = a; },
  destroy: function () { api = null; },
  getParams: function () { return params; },
  updateParams: function (p) {
    if (typeof p.text === 'string' && p.text.length > 0) { text = p.text; params[0].value = text; }
  },
  render: function (c) { draw(c.canvas2d); },
};
`;

const AUDIO_ENTRY = `
var manifest = {
  id: 'community.audio', name: 'Audio Visualizer', version: '0.8.0',
  author: 'community', description: 'Real-time spectrum from the microphone input.',
  entry: 'dist/index.js',
};
var api = null;
var timer = null;
var phase = 0;
var bars = new Array(48).fill(0.2);
var params = [
  { key: 'speed', label: 'Speed', type: 'range', min: 0.2, max: 3, step: 0.1, value: 1 },
  { key: 'smooth', label: 'Smoothing', type: 'range', min: 0, max: 0.95, step: 0.05, value: 0.7 },
];
var speed = 1, smooth = 0.7;

function tick(canvas) {
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var w = canvas.width, h = canvas.height;
  phase += 0.05 * speed;
  for (var i = 0; i < bars.length; i++) {
    var target = 0.25 + 0.7 * Math.abs(Math.sin(phase * (0.4 + i / 24) + Math.sin(i * 1.7) * 2));
    bars[i] = smooth * bars[i] + (1 - smooth) * target;
  }
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);
  var bw = w / bars.length;
  for (var j = 0; j < bars.length; j++) {
    var bh = bars[j] * h * 0.9;
    var hue = 200 + j * 3;
    ctx.fillStyle = 'hsl(' + hue + ', 70%, 55%)';
    ctx.fillRect(j * bw + 1, h - bh, bw - 2, bh);
  }
  if (api) api.setStatus('computing');
}

function start(canvas) {
  stop();
  timer = setInterval(function () { tick(canvas); }, 33);
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

return {
  manifest: manifest,
  init: function (a) { api = a; },
  destroy: function () { stop(); api = null; },
  deactivate: function () { stop(); if (api) api.setStatus('ready'); },
  getParams: function () { return params; },
  updateParams: function (p) {
    if (typeof p.speed === 'number') { speed = p.speed; params[0].value = speed; }
    if (typeof p.smooth === 'number') { smooth = p.smooth; params[1].value = smooth; }
  },
  render: function (c) { start(c.canvas2d); },
};
`;

interface DemoSpec {
  manifest: Omit<PluginManifest, 'signature'>;
  seedHex: string;
  signer: string;
  permissions: string[];
  entrySource: string;
}

const DEMO_SPECS: Record<string, DemoSpec> = {
  'community.wordcloud': {
    manifest: {
      id: 'community.wordcloud',
      name: 'Word Cloud',
      nameI18n: { 'zh-CN': '词云', 'en-US': 'Word Cloud' },
      version: '0.9.0',
      author: 'community',
      description: 'Generate a word cloud from pasted text.',
      descriptionI18n: {
        'zh-CN': '从粘贴的文本生成词云。',
        'en-US': 'Generate a word cloud from pasted text.',
      },
      license: 'MIT',
      entry: 'dist/index.js',
      category: 'fun',
      icon: '☁',
    },
    seedHex: WORDCLOUD_SEED,
    signer: 'Community Demo Publisher',
    permissions: ['canvas:draw', 'params:read'],
    entrySource: WORDCLOUD_ENTRY,
  },
  'community.audio': {
    manifest: {
      id: 'community.audio',
      name: 'Audio Visualizer',
      nameI18n: { 'zh-CN': '音频可视化', 'en-US': 'Audio Visualizer' },
      version: '0.8.0',
      author: 'community',
      description: 'Real-time spectrum from the microphone input.',
      descriptionI18n: {
        'zh-CN': '来自麦克风输入的实时频谱。',
        'en-US': 'Real-time spectrum from the microphone input.',
      },
      license: 'MIT',
      entry: 'dist/index.js',
      category: 'fun',
      icon: '◀',
    },
    seedHex: AUDIO_SEED,
    signer: 'Community Demo Publisher',
    permissions: ['canvas:draw', 'params:read', 'timer:schedule'],
    entrySource: AUDIO_ENTRY,
  },
};

export const DEMO_PACKAGE_IDS: readonly string[] = Object.keys(DEMO_SPECS);

/** The signed manifest a demo package installs with (display source of truth). */
export function getDemoManifest(id: string): PluginManifest {
  const spec = DEMO_SPECS[id];
  if (!spec) throw new Error(`unknown demo package: ${id}`);
  return {
    ...spec.manifest,
    signature: signPackage(spec.manifest as PluginManifest, strToU8(spec.entrySource), {
      seedHex: spec.seedHex,
      signer: spec.signer,
      permissions: spec.permissions,
      signedAt: '2026-01-01T00:00:00.000Z',
    }),
  };
}

/** Build the signed .cspkg archive bytes for a demo package. */
export function buildDemoPackage(id: string): ArrayBuffer {
  const spec = DEMO_SPECS[id];
  if (!spec) throw new Error(`unknown demo package: ${id}`);
  const manifest = getDemoManifest(id);
  const entryBytes = strToU8(spec.entrySource);
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    [manifest.entry]: entryBytes,
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}
