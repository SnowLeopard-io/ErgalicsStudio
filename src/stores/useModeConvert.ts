// ==========================================================================
// Ergalics Studio — workbench mode conversion gate
//
// An intermediate confirmation step for switching between the three IR-backed
// editing surfaces (flow / block / code), mirroring the code-mode language
// switch draft: the conversion result is previewed (node counts, statements
// the target canvas cannot represent, regenerated code) and only applied
// after the user confirms. Entry points (top bar, welcome cards, command
// palette) call requestMode() instead of appStore.setMode() directly.
// ==========================================================================

import { create } from 'zustand';
import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';
import type { WorkbenchMode } from '@/types/editor';
import { codegen } from '@/editor/codegen';
import { isFlowStatement } from '@/editor/flow/convert';
import type { IRNode, IRProgram } from '@/editor/ir';

const EDIT_TARGETS = ['flow', 'block', 'code'] as const;
type EditTarget = (typeof EDIT_TARGETS)[number];

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
    if (mode === app.mode) return;
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
    useAppStore.getState().setMode(p.target);
  },

  cancel: () => set({ pending: null }),
}));
