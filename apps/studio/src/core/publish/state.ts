// ==========================================================================
// Ergalics Studio — publishing state model (manuscripts / library / notes)
//
// The scholarly surfaces persist their work inside `project.state.publish`,
// alongside the analysis assets, so a `.clproj` stays self-contained: the
// manuscript source, the BibTeX library, collaboration notebooks and the
// preprint records all travel with the project (and therefore with Git).
// ==========================================================================

import type { BibEntry } from './bibtex';
import type { CitationStyle } from './citation';
import type { CollabNote } from './collab';
import type { LatexTemplateId } from './latex';
import type { PreprintManifest } from './preprint';

export interface ManuscriptRecord {
  id: string;
  name: string;
  templateId: LatexTemplateId;
  citationStyle: CitationStyle;
  /** Raw `.tex` source, edited directly in the LaTeX editor. */
  source: string;
  /**
   * File stem of this manuscript's workspace bundle (`HELLO`, `HELLO-2`, …).
   * Assigned on the first workspace export and kept in sync with the file
   * manager so re-saving overwrites the same files.
   */
  workspaceStem?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PreprintRecord {
  id: string;
  name: string;
  fileName: string;
  createdAt: number;
  manifest: PreprintManifest;
  badgeSvg: string;
  hasLock: boolean;
  /** Deep link that reopens the locked project. */
  reproduceUrl?: string;
}

export interface PublishState {
  manuscripts: ManuscriptRecord[];
  activeManuscriptId: string | null;
  /** Shared BibTeX library used by every manuscript and the citation page. */
  library: BibEntry[];
  notes: CollabNote[];
  activeNoteId: string | null;
  preprints: PreprintRecord[];
}

export function createPublishState(): PublishState {
  return {
    manuscripts: [],
    activeManuscriptId: null,
    library: [],
    notes: [],
    activeNoteId: null,
    preprints: [],
  };
}

const TEMPLATE_IDS: LatexTemplateId[] = ['ieee', 'acm', 'nature', 'science', 'apa', 'chicago'];
const STYLE_IDS: CitationStyle[] = [
  'apa', 'mla', 'chicago', 'ieee', 'vancouver', 'nature', 'science',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Defensive normalisation for state loaded from an older/untrusted file. */
export function normalizePublishState(raw: unknown): PublishState {
  const base = createPublishState();
  if (!isRecord(raw)) return base;
  const manuscripts = Array.isArray(raw.manuscripts)
    ? raw.manuscripts.filter(isRecord).map((m): ManuscriptRecord => ({
        id: typeof m.id === 'string' ? m.id : crypto.randomUUID(),
        name: typeof m.name === 'string' ? m.name : 'Manuscript',
        templateId: TEMPLATE_IDS.includes(m.templateId as LatexTemplateId)
          ? (m.templateId as LatexTemplateId)
          : 'ieee',
        citationStyle: STYLE_IDS.includes(m.citationStyle as CitationStyle)
          ? (m.citationStyle as CitationStyle)
          : 'ieee',
        source: typeof m.source === 'string' ? m.source : '',
        workspaceStem:
          typeof m.workspaceStem === 'string'
            ? m.workspaceStem
            : typeof m.workspaceSuffix === 'string'
              ? m.workspaceSuffix
                ? `main${m.workspaceSuffix}`
                : 'main'
              : undefined,
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
        updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
      }))
    : [];
  const library = Array.isArray(raw.library)
    ? raw.library.filter(isRecord).map((entry): BibEntry => ({
        type: typeof entry.type === 'string' ? entry.type : 'misc',
        key: typeof entry.key === 'string' ? entry.key : 'ref',
        fields: isRecord(entry.fields)
          ? Object.fromEntries(
              Object.entries(entry.fields).filter((pair): pair is [string, string] =>
                typeof pair[1] === 'string'),
            )
          : {},
      }))
    : [];
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter(isRecord).map((note): CollabNote => ({
        id: typeof note.id === 'string' ? note.id : crypto.randomUUID(),
        title: typeof note.title === 'string' ? note.title : 'Research notebook',
        cells: Array.isArray(note.cells)
          ? note.cells.filter(isRecord).map((cell) => ({
              id: typeof cell.id === 'string' ? cell.id : crypto.randomUUID(),
              type: cell.type === 'code' ? 'code' : 'md',
              crdt: isRecord(cell.crdt) && Array.isArray(cell.crdt.atoms)
                ? {
                    site: typeof cell.crdt.site === 'string' ? cell.crdt.site : 'restored',
                    counter: typeof cell.crdt.counter === 'number' ? cell.crdt.counter : 0,
                    atoms: cell.crdt.atoms.filter(isRecord).map((atom) => ({
                      id: typeof atom.id === 'string' ? atom.id : crypto.randomUUID(),
                      after: typeof atom.after === 'string' ? atom.after : null,
                      value: typeof atom.value === 'string' ? atom.value : '',
                      deleted: atom.deleted === true,
                    })),
                  }
                : { site: 'restored', counter: 0, atoms: [] },
              comments: Array.isArray(cell.comments)
                ? cell.comments.filter(isRecord).map((c) => ({
                    id: typeof c.id === 'string' ? c.id : crypto.randomUUID(),
                    author: typeof c.author === 'string' ? c.author : 'anonymous',
                    text: typeof c.text === 'string' ? c.text : '',
                    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
                    resolved: c.resolved === true,
                  }))
                : [],
            }))
          : [],
        updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : Date.now(),
        history: Array.isArray(note.history) ? (note.history as CollabNote['history']) : [],
      }))
    : [];
  const preprints = Array.isArray(raw.preprints)
    ? raw.preprints.filter(isRecord).map((p): PreprintRecord => ({
        id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
        name: typeof p.name === 'string' ? p.name : 'preprint',
        fileName: typeof p.fileName === 'string' ? p.fileName : 'preprint.zip',
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
        manifest: isRecord(p.manifest)
          ? (p.manifest as unknown as PreprintManifest)
          : {
              schema: 'ergalics.preprint',
              version: 1,
              generatedAt: new Date().toISOString(),
              project: { id: '', name: '' },
              title: '',
              authors: '',
              figures: [],
              hasLock: false,
              files: [],
            },
        badgeSvg: typeof p.badgeSvg === 'string' ? p.badgeSvg : '',
        hasLock: p.hasLock === true,
        reproduceUrl: typeof p.reproduceUrl === 'string' ? p.reproduceUrl : undefined,
      }))
    : [];
  return {
    manuscripts,
    activeManuscriptId:
      typeof raw.activeManuscriptId === 'string'
        ? raw.activeManuscriptId
        : manuscripts[0]?.id ?? null,
    library,
    notes,
    activeNoteId:
      typeof raw.activeNoteId === 'string' ? raw.activeNoteId : notes[0]?.id ?? null,
    preprints,
  };
}
