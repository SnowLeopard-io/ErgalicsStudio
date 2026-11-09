// ==========================================================================
// Ergalics Studio — workbench mode conversion gate
//
// Switching between the three IR-backed editing surfaces (flow / block / code)
// is a real format conversion, not a re-render of one buffer: on confirm the
// program is converted into the target format, written to a sibling file
// (same directory, same base name, new suffix) and that new file is opened in
// the target mode. A preview of the conversion (node counts, statements the
// target canvas cannot represent, regenerated code) is shown first.
// Entry points (top bar, welcome cards, command palette) call requestMode()
// instead of appStore.setMode() directly.
// ==========================================================================

import { create } from 'zustand';
import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';
import type { WorkbenchMode } from '@/types/editor';
import { codegen } from '@/editor/codegen';
import { parseCodeToIR } from '@/editor/code/parse';
import { irToFlow, isFlowStatement } from '@/editor/flow/convert';
import { editorStoreOpenInMode } from '@/components/editor/fileEditors/openInMode';
import type { IRNode, IRProgram } from '@/editor/ir';

const EDIT_TARGETS = ['flow', 'block', 'code'] as const;
type EditTarget = (typeof EDIT_TARGETS)[number];

const CODE_EXT: Record<'python' | 'r' | 'js', string> = { python: 'py', r: 'r', js: 'js' };

/** Strip a known program/mode suffix to get the directory-relative base name. */
function baseName(path: string): string {
  return path
    .replace(/\.(flow|block)\.json$/i, '')
    .replace(/\.(py|js|mjs|r)$/i, '');
}

/** Sibling path for a converted file: same directory, same base, new suffix. */
function targetPathFor(
  source: string,
  target: EditTarget,
  language: 'python' | 'r' | 'js',
): string {
  const base = baseName(source);
  if (target === 'block') return `${base}.block.json`;
  if (target === 'flow') return `${base}.flow.json`;
  return `${base}.${CODE_EXT[language]}`;
}

export interface ModeConvertPreview {
  target: EditTarget;
  from: WorkbenchMode;
  /** Statements the target canvas renders as nodes/blocks. */
  nodes: number;
  /** Human-readable labels of statements the target canvas cannot show. */
  hidden: string[];
  /** Regenerated program text (the code-mode view after conversion). */
  code: string;
}

interface ModeConvertState {
  pending: ModeConvertPreview | null;
  requestMode: (mode: WorkbenchMode) => void;
  confirm: () => void;
  cancel: () => void;
}

function codegenLang(language: string): 'python' | 'r' | 'js' {
  return language === 'js' ? 'js' : language === 'r' ? 'r' : 'python';
}

/** Compact factual label for one IR statement (VarAssign unwrapped). */
function stmtLabel(node: IRNode): string {
  if (node.kind === 'VarAssign') return stmtLabel(node.value);
  if (node.kind === 'StudioCall') return `StudioCall.${node.method}`;
  return node.kind;
}

/** Statements a canvas cannot represent, for the given target. Flow's DAG
 *  only renders pipeline blocks (see BLOCK_FOR_KIND); block mode degrades
 *  functions to raw blocks so nothing is hidden; code mode shows everything. */
function hiddenFor(target: EditTarget, program: IRProgram): string[] {
  if (target !== 'flow') return [];
  const out: string[] = [];
  for (const stmt of program.functions) out.push(stmtLabel(stmt));
  for (const stmt of program.body) if (!isFlowStatement(stmt)) out.push(stmtLabel(stmt));
  return out;
}

export const useModeConvert = create<ModeConvertState>((set, get) => ({
  pending: null,

  requestMode: (mode) => {
    const app = useAppStore.getState();
    // Same mode: still make sure its canvas tab is in front (the user may be
    // looking at a file tab that was opened from inside that surface).
    if (mode === app.mode) {
      app.setMode(mode);
      return;
    }
    // Non-editing targets (standard) pass straight through — no conversion.
    if (!EDIT_TARGETS.includes(mode as EditTarget)) {
      app.setMode(mode);
      return;
    }
    const st = useEditorStore.getState();
    const sess = st.sessions.find((s) => s.id === st.activeSessionId);
    const ir = sess?.ir;
    // Nothing authored yet → nothing to preview, switch directly.
    if (!sess || !ir || (ir.body.length === 0 && ir.functions.length === 0)) {
      app.setMode(mode);
      return;
    }
    const target = mode as EditTarget;
    // Standard mode has no editing surface — entering flow/block/code from it
    // is a first render, not a conversion. Only confirm when converting
    // BETWEEN editing surfaces, where lossy re-rendering can bite.
    if (!EDIT_TARGETS.includes(app.mode as EditTarget)) {
      app.setMode(mode);
      return;
    }
    const nodes =
      target === 'flow'
        ? ir.body.filter(isFlowStatement).length
        : ir.body.length + ir.functions.length;
    set({
      pending: {
        target,
        from: app.mode,
        nodes,
        hidden: hiddenFor(target, ir),
        code: codegen(ir, codegenLang(sess.language)),
      },
    });
  },

  confirm: () => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    void convertToSiblingFile(p.target);
  },

  cancel: () => set({ pending: null }),
}));

/** Convert the active session's program into `target`'s on-disk format and
 *  write it NEXT TO the source file (same directory, same base name, new
 *  suffix). The target mode then opens that freshly written file — switching
 *  modes is a real format conversion on disk, not a re-render of one buffer.
 *  Sessions without a bound file cannot be placed anywhere, so they keep the
 *  old in-memory behavior. */
async function convertToSiblingFile(target: EditTarget): Promise<void> {
  const app = useAppStore.getState();
  const st = useEditorStore.getState();
  const sess = st.sessions.find((s) => s.id === st.activeSessionId);
  if (!sess || !sess.filePath || app.mode === target) {
    app.setMode(target);
    return;
  }
  const language = codegenLang(sess.language);
  // Code buffers are authoritative for code mode (the user may have typed
  // past the IR); block/flow keep their IR hub in sync while editing. If the
  // text cannot be parsed, fall back to the hub so conversion still works.
  let ir = sess.ir;
  if (app.mode === 'code') {
    try {
      ir = parseCodeToIR(sess.lastCode, language).program;
    } catch {
      ir = sess.ir;
    }
  }
  const path = targetPathFor(sess.filePath, target, language);
  if (path === sess.filePath) {
    app.setMode(target);
    return;
  }

  let text: string;
  const graph = target === 'flow' ? irToFlow(ir) : null;
  if (target === 'block') {
    text = JSON.stringify({ version: 1, kind: 'ergalics-block', ir }, null, 2);
  } else if (graph) {
    text = JSON.stringify({ version: 1, kind: 'ergalics-flow', graph }, null, 2);
  } else {
    text = codegen(ir, language);
  }

  if (!(await app.saveWorkspaceFile(path, text))) return;

  if (target === 'code') {
    editorStoreOpenInMode({ mode: 'code', language, code: text, path });
  } else if (target === 'block') {
    editorStoreOpenInMode({ mode: 'block', ir, path });
  } else if (graph) {
    editorStoreOpenInMode({ mode: 'flow', graph, path });
  }
}
