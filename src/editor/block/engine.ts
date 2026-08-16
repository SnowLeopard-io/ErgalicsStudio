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
import { createKidsTheme } from './theme';
import { TOOLBOX } from './toolbox';
import { workspaceJSONToIR, irToWorkspaceJSON } from './convert';
import type { IRProgram } from '../ir/types';

let initialized = false;

/** Register custom blocks, locale and theme. Idempotent. */
export function initBlocklyEngine(locale: 'zh-CN' | 'en-US', dark: boolean): void {
  // Register only the block types not already present — `defineBlocksWithJsonArray`
  // throws on duplicates, and HMR can re-run this module with a fresh `initialized`.
  const missing = BLOCK_DEFS.filter((d) => !(d.type in Blockly.Blocks));
  if (missing.length > 0) {
    Blockly.defineBlocksWithJsonArray(missing as unknown as Parameters<typeof Blockly.defineBlocksWithJsonArray>[0]);
  }
  if (!initialized) {
    initialized = true;
    Blockly.setLocale((locale === 'zh-CN' ? zhHans : en) as unknown as { [key: string]: string });
  }
  Blockly.Theme.defineTheme('studio-kids', createKidsTheme(dark) as unknown as Blockly.Theme);
}

/** Create a studio-kids workspace inside `div`. */
export function createWorkspace(div: HTMLElement): Blockly.WorkspaceSvg {
  return Blockly.inject(div, {
    toolbox: TOOLBOX as unknown as Blockly.utils.toolbox.ToolboxDefinition,
    theme: 'studio-kids',
    renderer: 'zelos',
    grid: {
      spacing: 20,
      length: 2,
      colour: document.documentElement.dataset.theme === 'dark' ? '#1a212c' : '#e8edf2',
      snap: true,
    },
    zoom: { controls: true, wheel: true, startScale: 1, maxScale: 1.6, minScale: 0.5 },
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
