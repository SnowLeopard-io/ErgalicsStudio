// ==========================================================================
// Ergalics Studio — workbench conversion gate
//
// Every editable surface round-trips through the shared IR hub: flow, block
// and code (Python / R / JavaScript). Switching between any two of them is a
// real format conversion, not a re-render of one buffer: on confirm the
// program is converted into the target format, written to a sibling file
// (same directory, same base name, new suffix) and that new file is opened in
// the target surface/mode. A preview of the conversion (node counts,
// statements the target canvas cannot represent, regenerated code, output
// path) is shown first.
//
// Entry points (top bar convert menu, mode cards, command palette) call
// requestTarget()/requestMode() instead of appStore.setMode() directly.
// ==========================================================================

import { create } from 'zustand';
import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';
import type { CodeLanguage, WorkbenchMode } from '@/types/editor';
import { codegen } from '@/editor/codegen';
import { parseCodeToIR } from '@/editor/code/parse';
import { irToFlow, isFlowStatement } from '@/editor/flow/convert';
import { editorStoreOpenInMode } from '@/components/editor/fileEditors/openInMode';
import type { IRNode, IRProgram } from '@/editor/ir';

const EDIT_TARGETS = ['flow', 'block', 'code'] as const;
type EditTarget = (typeof EDIT_TARGETS)[number];

/** A conversion destination: another workbench mode, or another code dialect
 *  (which implies code mode). Language targets are what makes Python ⇄ R ⇄ JS
 *  go through the same save-then-open pipeline as mode switches. */
export type ConvertTarget =
  | { kind: 'mode'; mode: EditTarget }
  | { kind: 'language'; language: CodeLanguage };

const CODE_EXT: Record<CodeLanguage, string> = { python: 'py', r: 'r', js: 'js' };

/** Strip a known program/mode suffix to get the directory-relative base name. */
function baseName(path: string): string {
  return path
    .replace(/\.(flow|block)\.json$/i, '')
    .replace(/\.(py|js|mjs|r|rscript)$/i, '');
}

/** Sibling path for a converted file: same directory, same base, new suffix. */
function targetPathFor(
  source: string,
  target: EditTarget,
  language: CodeLanguage,
): string {
  const base = baseName(source);
  if (target === 'block') return `${base}.block.json`;
  if (target === 'flow') return `${base}.flow.json`;
  return `${base}.${CODE_EXT[language]}`;
}

interface ModeConvertPreview {
  target: ConvertTarget;
  /** Workbench mode the conversion lands in (language → code). */
  targetMode: EditTarget;
  /** i18n key of the source surface label (mode or code language). */
  fromKey: string;
  /** i18n key of the target surface label (mode or code language). */
  toKey: string;
  /** Statements the target canvas renders as nodes/blocks. */
  nodes: number;
  /** Human-readable labels of statements the target canvas cannot show. */
  hidden: string[];
  /** Regenerated program text (the code view after conversion). */
  code: string;
  /** Sibling file the conversion writes; null when the session is unbound. */
  path: string | null;
}

interface ModeConvertState {
  pending: ModeConvertPreview | null;
  requestTarget: (target: ConvertTarget) => void;
  requestMode: (mode: WorkbenchMode) => void;
  confirm: () => void;
  cancel: () => void;
}

/** Session language → codegen dialect. */
function codegenLang(language: string): CodeLanguage {
  return language === 'js' ? 'js' : language === 'r' ? 'r' : 'python';
}

/** i18n key for the surface the user is converting FROM. */
function sourceKey(mode: WorkbenchMode, language: CodeLanguage): string {
  return mode === 'code' ? `editor.lang.${language}` : `workbench.mode.${mode}`;
}

/** i18n key for the conversion destination. */
function targetKey(target: ConvertTarget): string {
  return target.kind === 'mode' ? `workbench.mode.${target.mode}` : `editor.lang.${target.language}`;
}

/** Authoritative program of a session: code surfaces may hold text newer than
 *  the IR hub, so reparse their buffer; flow/block keep the IR in sync. */
function programOf(
  session: { ir: IRProgram; lastCode: string; language: CodeLanguage },
  mode: WorkbenchMode,
): IRProgram {
  if (mode === 'code' && session.lastCode.trim() !== '') {
    try {
      return parseCodeToIR(session.lastCode, codegenLang(session.language)).program;
    } catch {
      return session.ir;
    }
  }
  return session.ir;
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

  requestTarget: (target) => {
    const app = useAppStore.getState();
    const st = useEditorStore.getState();
    const sess = st.sessions.find((s) => s.id === st.activeSessionId);
    const targetMode: EditTarget = target.kind === 'mode' ? target.mode : 'code';

    // Same surface: still make sure its canvas tab is in front (the user may
    // be looking at a file tab that was opened from inside that surface).
    if (target.kind === 'mode' && app.mode === target.mode) {
      app.setMode(target.mode);
      return;
    }
    if (
      target.kind === 'language' &&
      app.mode === 'code' &&
      (sess?.language ?? 'python') === target.language
    ) {
      app.setMode('code');
      return;
    }

    // Standard mode has no editing surface — entering flow/block/code from it
    // is a first render, not a conversion. A language target still applies the
    // chosen dialect before code mode opens.
    if (!EDIT_TARGETS.includes(app.mode as EditTarget)) {
      if (target.kind === 'language' && sess && sess.language !== target.language) {
        const text = codegen(programOf(sess, 'code'), codegenLang(target.language));
        st.applyLanguageWithCode(
          sess.id,
          target.language,
          text.trim() !== '' ? text : sess.lastCode,
        );
      } else if (target.kind === 'language' && !sess) {
        st.createSession('code', target.language);
      }
      app.setMode(targetMode);
      return;
    }

    const ir = sess ? programOf(sess, app.mode) : null;
    // Nothing authored yet → nothing to preview, switch directly.
    if (!sess || !ir || (ir.body.length === 0 && ir.functions.length === 0)) {
      app.setMode(targetMode);
      return;
    }

    const nodes =
      targetMode === 'flow'
        ? ir.body.filter(isFlowStatement).length
        : ir.body.length + ir.functions.length;
    const outputLanguage =
      target.kind === 'language' ? target.language : sess.language;
    set({
      pending: {
        target,
        targetMode,
        fromKey: sourceKey(app.mode, sess.language),
        toKey: targetKey(target),
        nodes,
        hidden: hiddenFor(targetMode, ir),
        code: codegen(ir, codegenLang(outputLanguage)),
        path: sess.filePath
          ? targetPathFor(sess.filePath, targetMode, outputLanguage)
          : null,
      },
    });
  },

  requestMode: (mode) => {
    // Non-editing targets (standard) pass straight through — no conversion.
    if (!EDIT_TARGETS.includes(mode as EditTarget)) {
      useAppStore.getState().setMode(mode);
      return;
    }
    get().requestTarget({ kind: 'mode', mode: mode as EditTarget });
  },

  confirm: () => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    void convertToSiblingFile(p.target);
  },

  cancel: () => set({ pending: null }),
}));

/** Convert the active session's program into the target's on-disk format and
 *  write it NEXT TO the source file (same directory, same base name, new
 *  suffix). The target surface then opens that freshly written file — switching
 *  modes OR code languages is a real format conversion on disk, not a re-render
 *  of one buffer. Sessions without a bound file cannot be placed anywhere, so
 *  they keep the old in-memory behavior. */
async function convertToSiblingFile(target: ConvertTarget): Promise<void> {
  const app = useAppStore.getState();
  const st = useEditorStore.getState();
  const sess = st.sessions.find((s) => s.id === st.activeSessionId);
  const targetMode: EditTarget = target.kind === 'mode' ? target.mode : 'code';
  const targetLanguage: CodeLanguage =
    target.kind === 'language' ? target.language : (sess?.language ?? 'python');

  if (!sess) {
    if (target.kind === 'language') st.createSession('code', target.language);
    app.setMode(targetMode);
    return;
  }
  if (app.mode === targetMode && sess.language === targetLanguage) return;

  const ir = programOf(sess, app.mode);

  // Unbound sessions have no location to write a sibling file to; apply the
  // language switch in memory and let the mode surface take over.
  if (!sess.filePath) {
    if (target.kind === 'language') {
      const text = codegen(ir, codegenLang(target.language));
      st.applyLanguageWithCode(
        sess.id,
        target.language,
        text.trim() !== '' ? text : sess.lastCode,
      );
    }
    app.setMode(targetMode);
    return;
  }

  const path = targetPathFor(sess.filePath, targetMode, targetLanguage);
  if (path === sess.filePath && targetMode === app.mode) {
    app.setMode(targetMode);
    return;
  }

  let text: string;
  const graph = targetMode === 'flow' ? irToFlow(ir) : null;
  if (targetMode === 'block') {
    text = JSON.stringify({ version: 1, kind: 'ergalics-block', ir }, null, 2);
  } else if (graph) {
    text = JSON.stringify({ version: 1, kind: 'ergalics-flow', graph }, null, 2);
  } else {
    text = codegen(ir, codegenLang(targetLanguage));
  }

  if (!(await app.saveWorkspaceFile(path, text))) return;

  if (targetMode === 'code') {
    editorStoreOpenInMode({
      mode: 'code',
      language: targetLanguage,
      code: text,
      path,
    });
  } else if (targetMode === 'block') {
    editorStoreOpenInMode({ mode: 'block', ir, path });
  } else if (graph) {
    editorStoreOpenInMode({ mode: 'flow', graph, path });
  }
}
