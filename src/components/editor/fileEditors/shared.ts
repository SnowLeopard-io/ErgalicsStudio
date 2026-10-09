// ==========================================================================
// Ergalics Studio — file editor tab helpers (detect + repo IO)
//
// Shared by the explorer routing (which editor opens a file) and the editor
// components themselves (disk reload on external change).
// ==========================================================================

import type { FileEditorKind } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getVfs } from '@/core/vfs';

/** Monaco language id for an editable code file. */
export function monacoLanguageFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.r') || lower.endsWith('.rscript')) return 'r';
  return 'javascript';
}

/** Which editor kind a file opens with (null = plain preview). Design doc:
 *  `.py/.js/.r` → code, `*.flow.json` → flow DAG, `*.block.json` → Blockly. */
export function editorKindForFile(name: string): FileEditorKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.py') || lower.endsWith('.js') || lower.endsWith('.mjs')) return 'code';
  if (lower.endsWith('.r') || lower.endsWith('.rscript')) return 'code';
  if (lower.endsWith('.flow.json')) return 'flow';
  if (lower.endsWith('.block.json')) return 'block';
  return null;
}

/** Flow file payload shape (`{version, kind, graph}`). */
export interface FlowFilePayload {
  version: 1;
  kind: 'ergalics-flow';
  graph: {
    instances: unknown[];
    connections: unknown[];
    viewport?: { x: number; y: number; zoom: number };
  };
}

/** Block file payload shape (`{version, kind, ir}`). */
export interface BlockFilePayload {
  version: 1;
  kind: 'ergalics-block';
  ir: unknown;
}

/** Parse a flow file payload; null when the JSON is not an editable flow. */
export function parseFlowPayload(raw: string): FlowFilePayload | null {
  try {
    const parsed = JSON.parse(raw) as FlowFilePayload;
    if (parsed?.kind !== 'ergalics-flow' || !Array.isArray(parsed?.graph?.instances)) return null;
    if (!Array.isArray(parsed.graph.connections)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Parse a block file payload; null when the JSON is not an editable block. */
export function parseBlockPayload(raw: string): BlockFilePayload | null {
  try {
    const parsed = JSON.parse(raw) as BlockFilePayload;
    if (parsed?.kind !== 'ergalics-block' || !parsed?.ir) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read the current text of a workspace file (external-change reload). */
export async function readRepoFileText(path: string): Promise<string | null> {
  const project = useProjectStore.getState().project;
  if (!project) return null;
  try {
    return await getVfs().readFile(getProjectRepoPath(project), path);
  } catch {
    return null;
  }
}
