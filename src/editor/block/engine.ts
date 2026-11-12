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
import { requestDataFilePick } from './data-file-picker';
import type { IRProgram } from '../ir/types';

/** Theme name (dark variants get their own so redefinition never throws). */
const THEME_NAME = (dark: boolean) => (dark ? 'studio-kids-dark' : 'studio-kids');

/**
 * A text field whose click opens the two-column data-file picker instead of
 * the inline editor. The chosen name is written back with `setValue`, so the
 * normal Blockly change event updates the IR exactly like a typed edit.
 *
 * `fromJson` must be re-declared: `FieldTextInput.fromJson` hard-codes the
 * base class, which would deserialize saved `.block.json` into a plain text
 * field and lose the picker behaviour.
 */
class FieldDataFile extends Blockly.FieldTextInput {
  static override fromJson(options: Blockly.FieldTextInputFromJsonConfig): FieldDataFile {
    return new FieldDataFile(options.text);
  }

  protected override showEditor_(_e?: Event): void {
    requestDataFilePick({
      value: String(this.getValue() ?? ''),
      select: (name) => {
        this.setValue(name);
      },
    });
  }
}

// Blockly locale/theme are process-global. Re-applying them on every workspace
// creation (each block/flow file tab mount) meant spreading the whole message
// dictionary and throwing/catching on an already-registered theme each time.
let appliedLocale: 'zh-CN' | 'en-US' | null = null;
const definedThemes = new Set<string>();

/** Register custom blocks, locale and theme. Idempotent. */
export function initBlocklyEngine(locale: 'zh-CN' | 'en-US', dark: boolean): void {
  // The custom picker field must exist before any block is constructed from
  // saved JSON. `register` throws on duplicates (HMR / StrictMode re-runs).
  try {
    Blockly.fieldRegistry.register('field_data_file', FieldDataFile);
  } catch {
    // Already registered — safe to ignore.
  }
  // Register only the block types not already present — `defineBlocksWithJsonArray`
  // throws on duplicates, and HMR can re-run this module with a fresh flag.
  const missing = BLOCK_DEFS.filter((d) => !(d.type in Blockly.Blocks));
  if (missing.length > 0) {
    Blockly.defineBlocksWithJsonArray(missing as unknown as Parameters<typeof Blockly.defineBlocksWithJsonArray>[0]);
  }
  // Apply locale messages (base Blockly messages + our custom block messages)
  // so `%{BKY_*}` refs resolve to the current language. Only when it changed.
  if (appliedLocale !== locale) {
    const base = (locale === 'zh-CN' ? zhHans : en) as unknown as Record<string, string>;
    Blockly.setLocale({ ...base, ...BLOCK_I18N[locale] });
    appliedLocale = locale;
  }
  // Blockly.Theme.defineTheme throws when the name is already registered, so
  // define each variant once; a dark/light toggle re-injects the workspace
  // with the already-registered theme under its own name.
  const themeName = THEME_NAME(dark);
  if (!definedThemes.has(themeName)) {
    try {
      Blockly.Theme.defineTheme(themeName, createKidsTheme(dark) as unknown as Blockly.Theme);
    } catch {
      // Already defined (HMR re-evaluated this module) — safe to ignore.
    }
    definedThemes.add(themeName);
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
  centerWorkspace(ws);
}

/** Put the loaded blocks in the middle of the canvas instead of leaving them
 *  pinned to the top-left corner (a headless workspace has no viewport, so
 *  this is a no-op there). */
function centerWorkspace(ws: Blockly.Workspace): void {
  const svg = ws as Blockly.WorkspaceSvg;
  if (typeof svg.centerOnBlock !== 'function' || typeof svg.render !== 'function') return;
  svg.render();
  const first = ws.getTopBlocks(true)[0];
  if (first) svg.centerOnBlock(first.id);
  else svg.scrollCenter();
}

export function disposeWorkspace(ws: Blockly.WorkspaceSvg): void {
  ws.dispose();
}
