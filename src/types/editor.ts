// ==========================================================================
// Ergalics Studio — editor (block/code mode) domain types
//
// Shared types for the Scratch-like Block mode and the Python/R Code mode.
// See docs/guide/block-mode.md §9 for the full data model. The IR lives in
// `@/editor/ir` and is referenced here as the single source of truth.
// ==========================================================================

import type { DataValue } from './datatable';
import type { IRProgram } from '@/editor/ir/types';

/** Four workbench modes (upgraded from the two-way Standard|Flow toggle). */
export type WorkbenchMode = 'standard' | 'flow' | 'block' | 'code';

/** Languages supported by code mode (Phase 1 = Python, Phase 3 = R, later JS). */
export type CodeLanguage = 'python' | 'r' | 'js';

/** Which side of the block⇄code sync last changed. */
export type SyncState = 'clean' | 'block-dirty' | 'code-dirty' | 'conflict';

export interface ConsoleEntry {
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
  timestamp: number;
}

export interface EditorRunResult {
  ok: boolean;
  /** Top-level variable name → value snapshot (VariablePanel). */
  outputs: Record<string, DataValue>;
  console: ConsoleEntry[];
  error?: { line?: number; message: string };
  gpuMs?: number;
  durationMs: number;
}

export interface EditorSession {
  id: string;
  mode: 'block' | 'code';
  language: CodeLanguage;
  /** Single source of truth: the IR program. Code text is regenerable. */
  ir: IRProgram;
  /** Last synced code text (used to restore cursor/diff on re-sync). */
  lastCode: string;
  syncState: SyncState;
  createdAt: number;
  updatedAt: number;
}

export function createEditorSession(
  mode: 'block' | 'code',
  language: CodeLanguage,
  ir: IRProgram,
): EditorSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    mode,
    language,
    ir,
    lastCode: '',
    syncState: 'clean',
    createdAt: now,
    updatedAt: now,
  };
}
