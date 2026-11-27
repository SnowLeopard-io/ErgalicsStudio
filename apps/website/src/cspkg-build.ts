// ==========================================================================
// Website .cspkg builder — produces a REAL, signed, loadable plugin archive.
//
// Two historical bugs this file fixes:
//
//  1. ID collision. The website catalog reuses the built-ins' ids
//     (example.fluid, fun.mandelbrot, …). Installing such a package whose id
//     already lives in the workstation registry hit an early-return in
//     pluginStore.load() (`isLoaded(id)`), so the download appeared in the
//     list but never actually activated — the right-hand panel stayed empty.
//     Every package built here is namespaced under `market.` so it can never
//     collide with a built-in id.
//
//  2. Unsigned + non-functional stub. The old archive shipped an empty
//     manifest with `getParams(){return[]}` and no render/activate, and it
//     was unsigned, so the workstation both raised the "unsigned" gate and
//     showed nothing usable. Each package now carries a genuinely functional
//     animated plugin (canvas2d render loop + live parameter controls) and is
//     signed with the website demo-publisher key, which the workstation trusts
//     out of the box (see OFFICIAL_TRUSTED_KEYS).
//
// The signing canonicalization is mirrored from the workstation
// (`src/core/plugin-signing.ts`) via plugin-sign.ts; the shared ed25519/SHA
// primitives come straight from `src/core/crypto-primitives`, and
// tests/plugin-signing/website-cspkg.test.ts verifies that a package built
// here passes the workstation verifier byte-for-byte.
// ==========================================================================

import { buildZipArchive } from './zip';
import { computeFingerprint, getPublicKeyBytes, signPackage } from './plugin-sign';

/**
 * Website demo-publisher seed. Ships in the public website bundle on purpose:
 * the marketplace builds packages client-side. This is the SAME trust tier as
 * the in-app community demo packages (sandboxed, labelled as demos) — it is
 * NOT the offline official-release secret. The workstation trusts the matching
 * public key so a website download installs without the manual trust prompt.
 */
const WEBSITE_PUBLISHER_SEED = '66fd265b1796c7283d5d8d254fa13b9b078e23414f3e64bb1cc6b49556b80090';
const WEBSITE_PUBLISHER = 'Ergalics Studio Website (demo publisher)';

const enc = new TextEncoder();

/** Namespace a catalog id so an installed package never shadows a built-in. */
export function marketplacePackageId(catalogId: string): string {
  return catalogId.startsWith('market.') ? catalogId : `market.${catalogId}`;
}

/**
 * Build the entry source for a marketplace package. It is a self-contained,
 * genuinely functional plugin: an animated canvas2d visualization whose speed,
 * hue and label are driven by live parameter controls, so the workstation's
 * right-hand panel is populated and the plugin is usable immediately after
 * install. Written as a plain ES5 function body returning the plugin object —
 * the exact contract `evaluatePluginLegacy` / the worker sandbox expect.
 */
function buildEntrySource(opts: {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
}): string {
  const manifest = {
    id: opts.id,
    name: opts.name,
    version: opts.version,
    author: opts.author,
    description: opts.description,
    entry: 'dist/index.js',
    category: 'fun',
  };
  return [
    '"use strict";',
    `var manifest = ${JSON.stringify(manifest)};`,
    'var api = null;',
    'var timer = null;',
    'var phase = 0;',
    'var speed = 1;',
    'var hue = 200;',
    'var label = ' + JSON.stringify(opts.name) + ';',
    'var params = [',
    "  { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 3, step: 0.1, value: 1 },",
    "  { key: 'hue', label: 'Color hue', type: 'range', min: 0, max: 360, step: 1, value: 200 },",
    "  { key: 'label', label: 'Caption', type: 'text', value: label, placeholder: 'Overlay text' },",
    '];',
    'function draw(canvas) {',
    '  if (!canvas || !canvas.getContext) return;',
    "  var ctx = canvas.getContext('2d');",
    '  if (!ctx) return;',
    '  var w = canvas.width, h = canvas.height;',
    "  ctx.fillStyle = '#0d1117';",
    '  ctx.fillRect(0, 0, w, h);',
    '  var cx = w / 2, cy = h / 2;',
    '  var n = 64;',
    '  for (var i = 0; i < n; i++) {',
    '    var a = (i / n) * Math.PI * 2 + phase;',
    '    var r = (h / 3) * (1 + 0.35 * Math.sin(phase * 2 + i * 0.5));',
    '    var x = cx + r * Math.cos(a);',
    '    var y = cy + r * Math.sin(a);',
    "    ctx.fillStyle = 'hsl(' + ((hue + i * 4) % 360) + ', 70%, 58%)';",
    '    ctx.beginPath();',
    '    ctx.arc(x, y, 3 + 2 * Math.sin(phase + i), 0, Math.PI * 2);',
    '    ctx.fill();',
    '  }',
    "  ctx.fillStyle = 'rgba(255,255,255,0.85)';",
    "  ctx.font = '16px sans-serif';",
    "  ctx.textAlign = 'center';",
    '  if (label) ctx.fillText(label, cx, 24);',
    '}',
    'function tick(canvas) { phase += 0.03 * speed; draw(canvas); }',
    'function start(canvas) { stop(); tick(canvas); timer = setInterval(function () { tick(canvas); }, 33); }',
    'function stop() { if (timer) { clearInterval(timer); timer = null; } }',
    'return {',
    '  manifest: manifest,',
    '  init: function (a) { api = a; },',
    '  destroy: function () { stop(); api = null; },',
    '  deactivate: function () { stop(); if (api) api.setStatus(\'ready\'); },',
    '  getParams: function () { return params; },',
    '  updateParams: function (p) {',
    "    if (typeof p.speed === 'number') { speed = p.speed; params[0].value = speed; }",
    "    if (typeof p.hue === 'number') { hue = p.hue; params[1].value = hue; }",
    "    if (typeof p.label === 'string') { label = p.label; params[2].value = label; }",
    '  },',
    '  render: function (c) { if (c && c.canvas2d) start(c.canvas2d); },',
    '};',
    '',
  ].join('\n');
}

export interface BuildCspkgOptions {
  /** Raw catalog id (will be namespaced with `market.`). */
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
}

/**
 * Build a signed, loadable .cspkg Blob for a marketplace listing. The manifest
 * `signature` field is produced over the canonical payload (sorted-key JSON +
 * entry bytes) with the website demo-publisher key, so the workstation's FR-05
 * gate verifies it against a built-in trusted key and installs without a
 * manual trust prompt.
 */
export function buildCspkg(opts: BuildCspkgOptions): Blob {
  const id = marketplacePackageId(opts.id);
  const entrySource = buildEntrySource({ ...opts, id });
  const entryBytes = enc.encode(entrySource);

  // The manifest we sign must be byte-identical to the one written into the
  // archive (minus the `signature` field, which canonicalization strips).
  const baseManifest = {
    id,
    name: opts.name,
    version: opts.version,
    author: opts.author,
    description: opts.description,
    category: 'fun',
    icon: 'sparkles',
    entry: 'dist/index.js',
  };
  const signature = signPackage(baseManifest as unknown as Record<string, unknown>, entryBytes, {
    seedHex: WEBSITE_PUBLISHER_SEED,
    signer: WEBSITE_PUBLISHER,
    permissions: ['canvas:draw', 'params:read', 'timer:schedule'],
  });
  const manifest = { ...baseManifest, signature };

  const zip = buildZipArchive({
    'manifest.json': enc.encode(JSON.stringify(manifest)),
    'dist/index.js': entryBytes,
  });
  return new Blob([zip], { type: 'application/zip' });
}

/** Fingerprint of the website demo-publisher key (for UI display). */
export const WEBSITE_PUBLISHER_FINGERPRINT = computeFingerprint(
  getPublicKeyBytes(WEBSITE_PUBLISHER_SEED),
);
