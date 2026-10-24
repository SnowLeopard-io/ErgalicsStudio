// ==========================================================================
// Ergalics Studio — Blockly workspace lifecycle (block mode)
//
// The only module in `block/` that imports the Blockly runtime (browser-only).
// Registration is idempotent (guarded per block type) so React StrictMode and
// HMR re-evaluation cannot double-register and throw.
// ==========================================================================

import * as Blockly from 'blockly/core';
import * as zhHans from 'blockly/msg/zh-hans';
import * as en from 'blockly/msg/en';
import { BLOCK_DEFS } from './blocks';
import { BLOCK_I18N } from './i18n';
import { createKidsTheme } from './theme';
import { TOOLBOX } from './toolbox';
import { workspaceJSONToIR, irToWorkspaceJSON } from './convert';
import type { IRProgram } from '../ir/types';

/** Theme name (dark variants get their own so redefinition never throws). */
export const THEME_NAME = (dark: boolean) => (dark ? 'studio-kids-dark' : 'studio-kids');

/** Register custom blocks, locale and theme. Idempotent for block defs. */
export function initBlocklyEngine(locale: 'zh-CN' | 'en-US', dark: boolean): void {
  // Register only the block types not already present — `defineBlocksWithJsonArray`
  // throws on duplicates, and HMR can re-run this module with a fresh flag.
  const missing = BLOCK_DEFS.filter((d) => !(d.type in Blockly.Blocks));
  if (missing.length > 0) {
    Blockly.defineBlocksWithJsonArray(missing as unknown as Parameters<typeof Blockly.defineBlocksWithJsonArray>[0]);
  }
  // Apply locale messages on every call (base Blockly messages + our custom
  // block messages) so `%{BKY_*}` refs resolve to the current language.
  const base = (locale === 'zh-CN' ? zhHans : en) as unknown as Record<string, string>;
  Blockly.setLocale({ ...base, ...BLOCK_I18N[locale] });
  // Blockly.Theme.defineTheme throws when the name is already registered, so
  // define each variant once; a dark/light toggle re-injects the workspace
  // with the already-registered theme under its own name.
  try {
    Blockly.Theme.defineTheme(THEME_NAME(dark), createKidsTheme(dark) as unknown as Blockly.Theme);
  } catch {
    // Already defined — safe to ignore (theme is registered once per variant).
  }
}

/** Create a studio-kids workspace inside `div`. */
export function createWorkspace(div: HTMLElement): Blockly.WorkspaceSvg {
  const dark = document.documentElement.dataset.theme === 'dark';
  return Blockly.inject(div, {
    // Serve Blockly's media (sprites + sounds) from the bundled copy in
    // public/blockly/ — the default CDN (static.blockly.com) fails TLS
    // validation for some users and throws unhandled fetch rejections.
    media: `${import.meta.env.BASE_URL}blockly/`,
    toolbox: TOOLBOX as unknown as Blockly.utils.toolbox.ToolboxDefinition,
    theme: THEME_NAME(dark),
    renderer: 'geras',
    grid: {
      spacing: 20,
      length: 2,
      colour: dark ? '#1a212c' : '#e8edf2',
      snap: true,
    },
    zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 1.4, minScale: 0.4 },
    trashcan: true,
    move: { scrollbars: true, drag: true, wheel: true },
  });
}

/** Serialize a live workspace to an IR program. */
export function workspaceToIR(ws: Blockly.Workspace): IRProgram {
  return workspaceJSONToIR(Blockly.serialization.workspaces.save(ws));
}

/** Replace the workspace contents with the given IR program. */
export function loadIRIntoWorkspace(ws: Blockly.Workspace, program: IRProgram): void {
  const json = irToWorkspaceJSON(program);
  Blockly.Events.disable();
  try {
    ws.clear();
    Blockly.serialization.workspaces.load(json, ws);
  } finally {
    Blockly.Events.enable();
  }
}

export function disposeWorkspace(ws: Blockly.WorkspaceSvg): void {
  ws.dispose();
}
