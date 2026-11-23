// ==========================================================================
// Ergalics Studio — Plugin Data Editor, Ingestion & Sync Store
//
// Central orchestrator for:
//  1. Per-plugin data bindings (`bindings`) + stale-file notifications when
//     a linked project file is modified externally (`project:data-file:updated`).
//  2. Schema-validated ingestion (`ingestForPlugin`) — dynamically loads the
//     Zod validation engine on demand so `zod` stays out of the first-screen
//     bundle.
//  3. Interactive modals: ColumnMappingModal (`mappingRequest`) and
//     ValidationErrorModal (`errorRequest`).
//  4. Dual-mode online editor (`editorSession`: `'docked'` bottom drawer with
//     live-sync toggle, or `'modal'` floating window).
// ==========================================================================

import { create } from 'zustand';
import type {
  DataSourceOrigin,
  DataValidationIssue,
  PluginDataBinding,
  PluginDataSchema,
  TabularDataSchema,
} from '@/types/dataSchema';
import type { ColumnMappingSuggestion, ParsedRawTable } from '@/core/data-schema/column-mapper';
import { resolvePluginDataSchemas } from '@/core/data-schema/presets';
import { hashTextContent } from '@/core/data-schema/profile-cache';
import { serializeTabularRows } from '@/core/data-schema/column-mapper';
import { on } from '@/core/events';
import { logger } from '@/core/logger';
import { getLocale } from '@/i18n';
import { useAppStore } from './appStore';
import { usePluginStore, runTracked, refreshParamDefs } from './pluginStore';
import { useProjectStore } from './projectStore';

export type DataEditorLayout = 'docked' | 'modal';

export interface ColumnMappingRequest {
  pluginId: string;
  schema: TabularDataSchema;
  fileName: string;
  text: string;
  origin: DataSourceOrigin;
  fileId?: string;
  parsed: ParsedRawTable;
  suggestion: ColumnMappingSuggestion;
}

export interface ValidationErrorRequest {
  pluginId: string;
  schema: PluginDataSchema;
  fileName: string;
  text: string;
  origin: DataSourceOrigin;
  fileId?: string;
  issues: DataValidationIssue[];
  totalErrorCount: number;
  columnMapping?: Record<string, string>;
  canSkipInvalidRows: boolean;
}

export interface DataEditorSession {
  layout: DataEditorLayout;
  /** Target plugin id (`null` when editing a standalone project data file). */
  pluginId: string | null;
  /** Active schema (`null` for schema-less raw CSV/text editing). */
  schema: PluginDataSchema | null;
  fileName: string;
  text: string;
  origin: 'project-file' | 'draft' | 'example';
  fileId?: string;
  /** Whether debounced 300ms live-sync pushes valid edits to the plugin canvas. */
  liveSync: boolean;
  /** Optional initial error location to jump to on open. */
  focusRow?: number;
  focusField?: string;
  /** Monotonic revision token so opening a new file resets local editor buffers. */
  sessionKey: number;
}

export interface StaleFileNotice {
  fileId: string;
  fileName: string;
  newHash: string;
}

export interface IngestOptions {
  pluginId: string;
  text: string;
  fileName: string;
  origin: DataSourceOrigin;
  fileId?: string;
  /** Explicit schema slot id (auto-picked by extension when omitted). */
  schemaId?: string;
  columnMapping?: Record<string, string>;
  skipInvalidRows?: boolean;
  /** Suppress success toast (used during 300ms live-sync ticks). */
  silent?: boolean;
}

export interface IngestOutcome {
  ok: boolean;
  pending?: 'mapping' | 'error';
  skippedRows?: number;
}

function bindingKey(pluginId: string, schemaId: string): string {
  return `${pluginId}::${schemaId}`;
}

function pickSchemaForFile(
  schemas: PluginDataSchema[],
  fileName: string,
  schemaId?: string,
): PluginDataSchema | null {
  if (schemas.length === 0) return null;
  if (schemaId) {
    const exact = schemas.find((s) => s.id === schemaId);
    if (exact) return exact;
  }
  const dot = fileName.lastIndexOf('.');
  const ext = dot < 0 ? '' : fileName.slice(dot).toLowerCase();
  if (ext) {
    const byExt = schemas.find((s) => s.extensions.map((e) => e.toLowerCase()).includes(ext));
    if (byExt) return byExt;
  }
  return schemas[0] ?? null;
}

/** Build starter template text for a schema (sampleRows / sample JSON / sampleText). */
export function buildSchemaTemplateText(schema: PluginDataSchema): string {
  if (schema.kind === 'tabular') {
    return serializeTabularRows(schema.sampleRows, schema);
  }
  if (schema.kind === 'json') {
    return JSON.stringify(schema.sample, null, 2);
  }
  if (schema.kind === 'text') {
    return schema.sampleText;
  }
  return '';
}

let nextSessionKey = 1;

interface DataEditorStore {
  bindings: Record<string, PluginDataBinding>;
  /** Keyed by `bindingKey(pluginId, schemaId)` when linked project file changed externally. */
  staleBindings: Record<string, StaleFileNotice>;
  mappingRequest: ColumnMappingRequest | null;
  errorRequest: ValidationErrorRequest | null;
  editorSession: DataEditorSession | null;
  /** Persisted docked drawer height in px. */
  dockHeight: number;

  setDockHeight: (px: number) => void;
  setEditorLayout: (layout: DataEditorLayout) => void;
  setEditorLiveSync: (liveSync: boolean) => void;
  updateEditorDraftText: (text: string) => void;
  markEditorSaved: (fileId: string, fileName: string, text: string) => void;
  closeEditor: () => void;
  closeMapping: () => void;
  closeError: () => void;
  dismissStale: (pluginId: string, schemaId: string) => void;
  clearBinding: (pluginId: string, schemaId: string) => void;

  /**
   * Open the dual-mode online data editor for a plugin (defaults to `'docked'`)
   * or a standalone project file (defaults to `'modal'`).
   */
  openEditor: (opts: {
    pluginId: string | null;
    schema: PluginDataSchema | null;
    fileName?: string;
    text?: string;
    origin?: 'project-file' | 'draft' | 'example';
    fileId?: string;
    layout?: DataEditorLayout;
    focusRow?: number;
    focusField?: string;
  }) => void;

  /**
   * Unified schema-aware ingestion entrypoint. Validates text via lazily
   * imported Zod engine, opens ColumnMappingModal / ValidationErrorModal on
   * issues, and delivers to `loadValidatedData` (or legacy `loadData`).
   */
  ingestForPlugin: (opts: IngestOptions) => Promise<IngestOutcome>;

  /** Load a schema's built-in sample template straight into the active plugin. */
  loadTemplateForPlugin: (pluginId: string, schema: PluginDataSchema) => Promise<IngestOutcome>;

  /** Reload a stale bound project file after external modification. */
  reloadStaleBinding: (pluginId: string, schemaId: string) => Promise<void>;
}

const DOCK_HEIGHT_STORAGE_KEY = 'ergalics:data-editor-dock-height';

function loadInitialDockHeight(): number {
  try {
    const raw = localStorage.getItem(DOCK_HEIGHT_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 180 && n <= 640) return n;
  } catch {
    /* ignore */
  }
  return 280;
}

export const useDataEditorStore = create<DataEditorStore>((set, get) => ({
  bindings: {},
  staleBindings: {},
  mappingRequest: null,
  errorRequest: null,
  editorSession: null,
  dockHeight: loadInitialDockHeight(),

  setDockHeight: (px) => {
    const clamped = Math.max(180, Math.min(640, Math.round(px)));
    set({ dockHeight: clamped });
    try {
      localStorage.setItem(DOCK_HEIGHT_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  },

  setEditorLayout: (layout) =>
    set((s) => (s.editorSession ? { editorSession: { ...s.editorSession, layout } } : s)),

  setEditorLiveSync: (liveSync) =>
    set((s) => (s.editorSession ? { editorSession: { ...s.editorSession, liveSync } } : s)),

  updateEditorDraftText: (text) =>
    set((s) => (s.editorSession ? { editorSession: { ...s.editorSession, text } } : s)),

  markEditorSaved: (fileId, fileName, text) =>
    set((s) =>
      s.editorSession
        ? {
            editorSession: {
              ...s.editorSession,
              fileId,
              fileName,
              text,
              origin: 'project-file',
            },
          }
        : s,
    ),

  closeEditor: () => set({ editorSession: null }),
  closeMapping: () => set({ mappingRequest: null }),
  closeError: () => set({ errorRequest: null }),

  dismissStale: (pluginId, schemaId) =>
    set((s) => {
      const k = bindingKey(pluginId, schemaId);
      if (!(k in s.staleBindings)) return s;
      const next = { ...s.staleBindings };
      delete next[k];
      return { staleBindings: next };
    }),

  clearBinding: (pluginId, schemaId) =>
    set((s) => {
      const k = bindingKey(pluginId, schemaId);
      const nextBindings = { ...s.bindings };
      const nextStale = { ...s.staleBindings };
      delete nextBindings[k];
      delete nextStale[k];
      return { bindings: nextBindings, staleBindings: nextStale };
    }),

  openEditor: (opts) => {
    const existing = opts.pluginId && opts.schema
      ? get().bindings[bindingKey(opts.pluginId, opts.schema.id)]
      : undefined;

    const text =
      opts.text ??
      existing?.lastAppliedText ??
      (opts.schema ? buildSchemaTemplateText(opts.schema) : '');

    const ext = opts.schema?.extensions[0] ?? '.csv';
    const fileName =
      opts.fileName ??
      existing?.fileName ??
      `${(opts.pluginId ?? 'data').replace(/^example\./, '')}${ext}`;

    const origin: 'project-file' | 'draft' | 'example' =
      opts.origin ??
      (existing?.origin === 'project-file'
        ? 'project-file'
        : existing?.origin === 'example'
          ? 'example'
          : 'draft');

    const fileId = opts.fileId ?? (origin === 'project-file' ? existing?.fileId : undefined);
    const layout: DataEditorLayout = opts.layout ?? (opts.pluginId ? 'docked' : 'modal');
    const liveSync = opts.pluginId !== null && (opts.schema?.liveSync ?? true);

    set({
      errorRequest: null,
      mappingRequest: null,
      editorSession: {
        layout,
        pluginId: opts.pluginId,
        schema: opts.schema,
        fileName,
        text,
        origin,
        fileId,
        liveSync,
        focusRow: opts.focusRow,
        focusField: opts.focusField,
        sessionKey: nextSessionKey++,
      },
    });
  },

  ingestForPlugin: async (opts) => {
    const pluginStore = usePluginStore.getState();
    const entry = pluginStore.registry.find((e) => e.id === opts.pluginId);
    const plugin = entry?.plugin;
    if (!plugin) {
      return { ok: false };
    }

    const locale = getLocale();
    const zh = locale.toLowerCase().startsWith('zh');
    const schemas = resolvePluginDataSchemas(plugin.manifest);
    const schema = pickSchemaForFile(schemas, opts.fileName, opts.schemaId);

    // Legacy fallback: plugins without a declared dataSchema keep existing behavior.
    if (!schema || schema.kind === 'binary') {
      if (typeof plugin.loadData !== 'function') return { ok: false };
      const file = new File([opts.text], opts.fileName, { type: 'text/plain' });
      await runTracked(
        {
          pluginId: opts.pluginId,
          kind: 'data-import',
          label: opts.fileName,
          detail: { bytes: file.size, origin: opts.origin },
        },
        async () => {
          await plugin.loadData?.(file);
        },
      );
      refreshParamDefs(opts.pluginId);
      return { ok: true };
    }

    // Lazily load Zod validation engine only when schema ingestion actually runs.
    const { validatePluginDataText, deliverValidatedPayload } = await import(
      '@/core/data-schema/ingestion'
    );

    const result = validatePluginDataText(opts.text, schema, {
      fileName: opts.fileName,
      origin: opts.origin,
      fileId: opts.fileId,
      locale,
      columnMapping: opts.columnMapping,
      skipInvalidRows: opts.skipInvalidRows,
    });

    if (result.status === 'needs_mapping' && schema.kind === 'tabular') {
      set({
        mappingRequest: {
          pluginId: opts.pluginId,
          schema,
          fileName: opts.fileName,
          text: opts.text,
          origin: opts.origin,
          fileId: opts.fileId,
          parsed: result.parsed,
          suggestion: result.suggestion,
        },
      });
      return { ok: false, pending: 'mapping' };
    }

    if (result.status === 'invalid') {
      const canSkipInvalidRows =
        schema.kind === 'tabular' &&
        result.parsed !== undefined &&
        result.issues.some((i) => i.row !== null);
      set({
        errorRequest: {
          pluginId: opts.pluginId,
          schema,
          fileName: opts.fileName,
          text: opts.text,
          origin: opts.origin,
          fileId: opts.fileId,
          issues: result.issues,
          totalErrorCount: result.totalErrorCount,
          columnMapping: opts.columnMapping,
          canSkipInvalidRows,
        },
      });
      return { ok: false, pending: 'error' };
    }

    if (result.status !== 'ok') {
      return { ok: false };
    }

    // Deliver validated payload to plugin inside tracked run history.
    try {
      await runTracked(
        {
          pluginId: opts.pluginId,
          kind: 'data-import',
          label: opts.fileName,
          detail: {
            schemaId: schema.id,
            origin: opts.origin,
            skippedRows: result.skippedRows || undefined,
          },
        },
        async () => {
          await deliverValidatedPayload(plugin, result.payload);
        },
      );
      refreshParamDefs(opts.pluginId);

      const appliedText = await result.payload.file.text();
      const key = bindingKey(opts.pluginId, schema.id);
      const bindingOrigin: PluginDataBinding['origin'] =
        opts.origin === 'project-file'
          ? 'project-file'
          : opts.origin === 'example'
            ? 'example'
            : opts.origin === 'online-editor'
              ? opts.fileId
                ? 'project-file'
                : 'draft'
              : 'upload-ephemeral';

      const binding: PluginDataBinding = {
        pluginId: opts.pluginId,
        schemaId: schema.id,
        origin: bindingOrigin,
        fileId: opts.fileId,
        fileName: opts.fileName,
        lastAppliedText: appliedText,
        contentHash: hashTextContent(opts.text),
        columnMapping: result.mapping,
        hasUnsavedDraft: bindingOrigin === 'draft',
        updatedAt: Date.now(),
      };

      set((s) => {
        const nextStale = { ...s.staleBindings };
        delete nextStale[key];
        return {
          bindings: { ...s.bindings, [key]: binding },
          staleBindings: nextStale,
          mappingRequest: null,
          errorRequest: null,
        };
      });

      if (!opts.silent) {
        const notify = useAppStore.getState().notify;
        if (result.skippedRows > 0) {
          notify(
            'warning',
            zh
              ? `已载入 ${opts.fileName}（跳过 ${result.skippedRows} 行无效数据）`
              : `Loaded ${opts.fileName} (skipped ${result.skippedRows} invalid row(s))`,
          );
        } else if (result.autoMappedNonExact && result.mapping) {
          const pairs = Object.entries(result.mapping)
            .filter(([tKey, sHead]) => tKey !== sHead)
            .map(([tKey, sHead]) => `${sHead}→${tKey}`)
            .slice(0, 3)
            .join(', ');
          notify(
            'success',
            zh
              ? `已载入 ${opts.fileName}${pairs ? `（自动映射：${pairs}）` : ''}`
              : `Loaded ${opts.fileName}${pairs ? ` (auto-mapped: ${pairs})` : ''}`,
          );
        } else {
          notify(
            'success',
            zh ? `已载入 ${opts.fileName}` : `Loaded ${opts.fileName}`,
          );
        }
      }

      return { ok: true, skippedRows: result.skippedRows };
    } catch (err) {
      logger.error('data-schema', 'deliverValidatedPayload failed', { pluginId: opts.pluginId }, err);
      useAppStore
        .getState()
        .notify(
          'error',
          zh
            ? `加载数据失败：${err instanceof Error ? err.message : String(err)}`
            : `Failed to load data: ${err instanceof Error ? err.message : String(err)}`,
        );
      return { ok: false };
    }
  },

  loadTemplateForPlugin: async (pluginId, schema) => {
    const text = buildSchemaTemplateText(schema);
    const ext = schema.extensions[0] ?? (schema.kind === 'json' ? '.json' : '.csv');
    return get().ingestForPlugin({
      pluginId,
      schemaId: schema.id,
      fileName: `${schema.id}-template${ext}`,
      text,
      origin: 'example',
    });
  },

  reloadStaleBinding: async (pluginId, schemaId) => {
    const key = bindingKey(pluginId, schemaId);
    const binding = get().bindings[key];
    if (!binding?.fileId) return;
    const entry = useProjectStore
      .getState()
      .project?.data.files.find((f) => f.id === binding.fileId || f.name === binding.fileName);
    if (!entry) {
      get().dismissStale(pluginId, schemaId);
      return;
    }
    await get().ingestForPlugin({
      pluginId,
      schemaId,
      fileName: entry.name,
      text: entry.content,
      origin: 'project-file',
      fileId: entry.id,
      columnMapping: binding.columnMapping,
    });
  },
}));

// ---- Subscribe to global project data updates for cross-plugin sync --------
on<{
  fileId: string;
  name: string;
  hash: string;
  replaced?: boolean;
  sourcePluginId?: string;
}>('project:data-file:updated', (evt) => {
  if (!evt?.fileId) return;
  const state = useDataEditorStore.getState();
  const nextStale = { ...state.staleBindings };
  let changed = false;

  for (const [k, binding] of Object.entries(state.bindings)) {
    const sameFile = binding.fileId === evt.fileId || binding.fileName === evt.name;
    if (!sameFile) continue;
    // Skip notifying the plugin that just triggered the save itself.
    if (evt.sourcePluginId && binding.pluginId === evt.sourcePluginId) continue;
    if (binding.contentHash === evt.hash) continue;
    nextStale[k] = {
      fileId: evt.fileId,
      fileName: evt.name,
      newHash: evt.hash,
    };
    changed = true;
  }

  if (changed) {
    useDataEditorStore.setState({ staleBindings: nextStale });
  }
});
