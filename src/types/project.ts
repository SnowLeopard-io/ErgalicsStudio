import { sanitizeSvg } from '../core/sanitize/sanitizeSvg';

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  format: string;
  content: string; // base64 or text content
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
}

export interface SceneState {
  objects?: unknown;
  background?: string;
}

export interface ProjectState {
  activePlugin: string | null;
  parameters: Record<string, Record<string, unknown>>;
  camera: CameraState | null;
  scene: SceneState | null;
  /** Block graph snapshot (present when a block canvas has been authored). */
  blockGraph?: import('./block').BlockGraphState | null;
  /** Editor sessions (block/code modes). See types/editor.ts. */
  editorSessions?: import('./editor').EditorSession[] | null;
  /** Currently active editor session id. */
  activeEditorSession?: string | null;
  /** Last-used workbench mode. */
  workbenchMode?: import('./editor').WorkbenchMode;
  /** Figure Studio sheets (publication figures). */
  figureSheets?: FigureSheet[] | null;
  /** Notebook (mixed markdown/code cells). */
  notebook?: import('../core/notebook/notebook').NotebookState | null;
  /** Sweep Studio plans (F2). */
  sweeps?: import('../core/sweep/types').SweepPlan[] | null;
  /** Sweep results keyed by plan id (F2). */
  sweepResults?: import('../core/sweep/types').SweepMap | null;
  /** Report Builder saved specs (F8). */
  reports?: import('../core/report/builder').ReportSpec[] | null;
  /** Data Profiler cached reports keyed by file id (F5, FR5.6). */
  profiles?: import('../core/profiler/profile').SavedProfile[] | null;
}

/** A multi-panel publication figure persisted in the project (Figure Studio). */
export interface FigureSheet {
  id: string;
  name: string;
  /** Journal template id (see core/figure/compose.ts JOURNAL_TEMPLATES). */
  templateId: string;
  /** Caption rendered beneath the panels ('\n' = forced line break). */
  caption: string;
  panels: import('../core/figure/compose').FigurePanel[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMetadata {
  version: string;
  description: string | null;
  tags: string[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: {
    files: FileEntry[];
    processed?: unknown;
  };
  state: ProjectState;
  metadata: ProjectMetadata;
}

export const PROJECT_FORMAT_VERSION = '1.0';

/** Fallback name for a project created without an explicit name. */
export const DEFAULT_PROJECT_NAME = 'Untitled';

export function createEmptyProject(name: string): Project {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: name.trim() || DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    data: { files: [], processed: undefined },
    state: {
      activePlugin: null,
      parameters: {},
      camera: null,
      scene: null,
      editorSessions: [],
      activeEditorSession: null,
      workbenchMode: 'standard',
      figureSheets: [],
      notebook: null,
      sweeps: [],
      sweepResults: {},
      reports: [],
      profiles: [],
    },
    metadata: {
      version: PROJECT_FORMAT_VERSION,
      description: null,
      tags: [],
    },
  };
}

export function touchProject(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

/**
 * Sanitize stored report figure SVGs at load time (issue #25): a `.clproj`
 * is an untrusted file and `sections[].svg` is embedded verbatim into the
 * exported report HTML, so the stored state must already be inert.
 */
function sanitizeReportSpec(spec: import('../core/report/builder').ReportSpec): import('../core/report/builder').ReportSpec {
  if (!spec || !Array.isArray(spec.sections)) return spec;
  const sections = spec.sections.map((section) =>
    section.type === 'figure' && typeof section.svg === 'string'
      ? { ...section, svg: sanitizeSvg(section.svg) }
      : section,
  );
  return { ...spec, sections };
}

export function cloneProject(project: Project): Project {
  return structuredClone(project) as Project;
}

/**
 * JSON cannot represent NaN/±Infinity (they would serialize to `null`, silently
 * shifting parameters across a save/load round trip — while `cloneProject`'s
 * structuredClone keeps them). Encode non-finite numbers as tagged strings and
 * decode them back on load, so the serialized form is lossless.
 */
const NONFINITE_TAG = '__erg_nonfinite__';

export function serializeProject(project: Project): string {
  return JSON.stringify(project, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return `${NONFINITE_TAG}${value}`;
    }
    return value;
  }, 2);
}

/**
 * Fill in every field a project is allowed to be missing.
 *
 * Projects reach here from three sources we do not fully control: IndexedDB
 * (possibly written by an older build), a `.clproj` file the user picked, and
 * a share link. Trusting them cost real crashes — `data` absent, or a
 * `blockGraph` object present but missing `instances` — so every consumer
 * downstream can now rely on a complete shape.
 */
export function normalizeProject(parsed: Project): Project {
  const state = (parsed.state ?? {}) as Partial<ProjectState>;
  return {
    id: parsed.id,
    name: parsed.name,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    data: {
      files: Array.isArray(parsed.data?.files) ? parsed.data.files : [],
      processed: parsed.data?.processed,
    },
    state: {
      activePlugin: state.activePlugin ?? null,
      parameters:
        state.parameters && typeof state.parameters === 'object' ? state.parameters : {},
      camera: state.camera ?? null,
      scene: state.scene ?? null,
      blockGraph: state.blockGraph ?? null,
      editorSessions: Array.isArray(state.editorSessions) ? state.editorSessions : [],
      activeEditorSession: state.activeEditorSession ?? null,
      workbenchMode: state.workbenchMode ?? 'standard',
      figureSheets: Array.isArray(state.figureSheets) ? state.figureSheets : [],
      notebook: state.notebook ?? null,
      sweeps: Array.isArray(state.sweeps) ? state.sweeps : [],
      sweepResults:
        state.sweepResults && typeof state.sweepResults === 'object' ? state.sweepResults : {},
      reports: Array.isArray(state.reports) ? state.reports.map(sanitizeReportSpec) : [],
      profiles: Array.isArray(state.profiles) ? state.profiles : [],
    },
    metadata: {
      version: parsed.metadata?.version ?? PROJECT_FORMAT_VERSION,
      description: parsed.metadata?.description ?? null,
      tags: Array.isArray(parsed.metadata?.tags) ? parsed.metadata.tags : [],
    },
  };
}

export function deserializeProject(raw: string): Project {
  const parsed = JSON.parse(raw, (_key, value) => {
    if (typeof value === 'string' && value.startsWith(NONFINITE_TAG)) {
      return Number(value.slice(NONFINITE_TAG.length));
    }
    return value;
  }) as Project | null;
  if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.name || !parsed.state) {
    throw new Error('Invalid project format');
  }
  return normalizeProject(parsed);
}
