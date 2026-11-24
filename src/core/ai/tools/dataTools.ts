// ==========================================================================
// Ergalics Studio — Schema-Aware Host Data Tools for the AI Assistant
//
// Gives the in-app agent first-class, Zod-validated read/write/patch control
// over plugin datasets and global project data files:
//   - get_plugin_data_schema   (read-only): inspect schema, current data & compatible project files
//   - set_plugin_data          (mutating):  write rows / JSON / CSV into a plugin with Zod self-healing
//   - patch_plugin_data        (mutating):  surgical cell/row edits on active tabular plugin data
//   - load_data_file_to_plugin (mutating):  load a project/example file with autonomous column mapping
//   - write_data_file          (mutating):  create or update a global project data file (with overwrite guard)
// ==========================================================================

import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { useDataEditorStore } from '@/stores/dataEditorStore';
import { resolveDataFile } from '@/core/dataFiles';
import { isSupportedDataFileName } from '@/core/fileFormat';
import { getScienceOutputs } from '@/core/research/scienceOutput';
import {
  columnLabel,
  extractTabularColumns,
  resolvePluginDataSchemas,
} from '@/core/data-schema/presets';
import {
  parseRawTabularText,
  serializeTabularRows,
} from '@/core/data-schema/column-mapper';
import { assessFileCompatibility } from '@/core/data-schema/profile-cache';
import { getLocale } from '@/i18n';
import type {
  PluginDataSchema,
  TabularCellScalar,
  TabularDataSchema,
  TabularRow,
} from '@/types/dataSchema';
import type { RegisteredTool, ToolResult } from './types';
import { errorResult, textResult } from './types';

const MAX_PREVIEW_CHARS = 4500;
const MAX_ROWS_WRITE = 10_000;

function makeTool(
  name: string,
  description: string,
  inputSchema: RegisteredTool['definition']['inputSchema'],
  handler: RegisteredTool['handler'],
  title: string,
): RegisteredTool {
  return { definition: { name, description, inputSchema, title, source: 'host' }, handler };
}

function escapeCsvCell(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serializeGenericRowsToCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  if (keys.length === 0) return '';
  const lines = [keys.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(keys.map((k) => escapeCsvCell(row[k])).join(','));
  }
  return lines.join('\n');
}

function summarizeSchema(schema: PluginDataSchema, locale: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: schema.id,
    kind: schema.kind,
    title: schema.titleI18n?.[locale] ?? schema.title,
    ...(schema.presetId ? { presetId: schema.presetId } : {}),
    extensions: schema.extensions,
  };
  if (schema.kind === 'tabular') {
    const cols = extractTabularColumns(schema);
    return {
      ...base,
      minRows: schema.minRows ?? 1,
      allowExtraColumns: schema.allowExtraColumns ?? false,
      columns: cols.map((c) => ({
        key: c.key,
        label: columnLabel(c, locale),
        required: c.required,
        type: c.displayType,
        ...(c.meta.unit ? { unit: c.meta.unit } : {}),
        ...(c.schema.enum ? { enum: c.schema.enum } : {}),
        ...(c.schema.minimum !== undefined ? { minimum: c.schema.minimum } : {}),
        ...(c.schema.exclusiveMinimum !== undefined
          ? { exclusiveMinimum: c.schema.exclusiveMinimum }
          : {}),
        ...(c.schema.maximum !== undefined ? { maximum: c.schema.maximum } : {}),
        ...(c.schema.exclusiveMaximum !== undefined
          ? { exclusiveMaximum: c.schema.exclusiveMaximum }
          : {}),
        ...(c.meta.aliases?.length ? { aliases: c.meta.aliases } : {}),
      })),
      sampleRows: schema.sampleRows.slice(0, 3),
    };
  }
  if (schema.kind === 'json') {
    return { ...base, jsonSchema: schema.schema, sample: schema.sample };
  }
  if (schema.kind === 'text') {
    return {
      ...base,
      grammarSummary: schema.grammarSummaryI18n?.[locale] ?? schema.grammarSummary,
      sampleText: schema.sampleText,
    };
  }
  return { ...base, mimeTypes: schema.mimeTypes };
}

function readScienceMetricsForPlugin(pluginId: string): unknown[] {
  const entry = getScienceOutputs()[pluginId];
  if (!entry) return [];
  return entry.metrics.map((m) => ({
    label: m.label,
    value: m.value,
    ...(m.unit ? { unit: m.unit } : {}),
  }));
}

async function ensureProjectPreservingPlugin(pluginId: string | null): Promise<void> {
  const projectStore = useProjectStore.getState();
  if (projectStore.project) return;
  const prevActiveId = usePluginStore.getState().activeId ?? pluginId;
  await projectStore.createProject('');
  if (prevActiveId && usePluginStore.getState().activeId !== prevActiveId) {
    await usePluginStore.getState().activate(prevActiveId);
    useAppStore.getState().showPluginCanvas();
  }
}

function pickTargetSchema(
  schemas: PluginDataSchema[],
  opts: { schemaId?: string; fileName?: string; prefersJson?: boolean; prefersTabular?: boolean },
): PluginDataSchema | null {
  if (schemas.length === 0) return null;
  if (opts.schemaId) {
    const exact = schemas.find((s) => s.id === opts.schemaId);
    if (exact) return exact;
  }
  if (opts.prefersJson) {
    const jsonS = schemas.find((s) => s.kind === 'json');
    if (jsonS) return jsonS;
  }
  if (opts.prefersTabular) {
    const tabS = schemas.find((s) => s.kind === 'tabular');
    if (tabS) return tabS;
  }
  if (opts.fileName) {
    const dot = opts.fileName.lastIndexOf('.');
    const ext = dot < 0 ? '' : opts.fileName.slice(dot).toLowerCase();
    if (ext) {
      const byExt = schemas.find((s) => s.extensions.map((e) => e.toLowerCase()).includes(ext));
      if (byExt) return byExt;
    }
  }
  return schemas[0] ?? null;
}

/** Sync an already-open online data editor if it is currently editing the same plugin. */
function syncOpenEditorIfMatching(
  pluginId: string,
  schema: PluginDataSchema | null,
  fileName: string,
  text: string,
  fileId: string | undefined,
  forceOpen: boolean,
): void {
  const editorStore = useDataEditorStore.getState();
  const cur = editorStore.editorSession;
  if (forceOpen || (cur && cur.pluginId === pluginId)) {
    editorStore.openEditor({
      pluginId,
      schema: schema ?? cur?.schema ?? null,
      fileName,
      text,
      origin: fileId ? 'project-file' : 'draft',
      fileId,
      layout: cur?.layout ?? 'docked',
    });
  }
}

// ---- Tool 1: get_plugin_data_schema (read-only) ----------------------------

const getPluginDataSchemaTool = makeTool(
  'get_plugin_data_schema',
  'Inspect the declarative data contract (required/optional columns, types, units, ranges, JSON schema, sample rows) of a plugin, along with its currently loaded data preview and compatible project files. Call this before set_plugin_data or patch_plugin_data.',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Plugin id; defaults to the active plugin.' },
    },
  },
  (args) => {
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active — pass pluginId or activate one first');
    const entry = usePluginStore.getState().registry.find((e) => e.id === id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);

    const locale = getLocale();
    const schemas = resolvePluginDataSchemas(entry.plugin.manifest);
    const dataState = useDataEditorStore.getState();

    // Locate live bound data or active editor draft for this plugin.
    const activeBinding =
      schemas
        .map((s) => dataState.bindings[`${id}::${s.id}`])
        .find((b) => b !== undefined) ??
      Object.values(dataState.bindings).find((b) => b.pluginId === id);

    const liveText =
      dataState.editorSession?.pluginId === id
        ? dataState.editorSession.text
        : activeBinding?.lastAppliedText;

    let currentData: Record<string, unknown> | null = null;
    if (liveText !== undefined) {
      const lines = liveText.split(/\r?\n/);
      const head = lines.slice(0, 30).join('\n');
      const truncated = lines.length > 30 || head.length > MAX_PREVIEW_CHARS;
      currentData = {
        fileName:
          dataState.editorSession?.pluginId === id
            ? dataState.editorSession.fileName
            : activeBinding?.fileName ?? 'data.csv',
        origin: activeBinding?.origin ?? 'draft',
        ...(activeBinding?.fileId ? { fileId: activeBinding.fileId } : {}),
        totalLines: lines.length,
        truncated,
        preview: head.slice(0, MAX_PREVIEW_CHARS),
      };
    }

    // Score project files against the plugin's schemas.
    const projectFiles = useProjectStore.getState().project?.data.files ?? [];
    const compatibleProjectFiles =
      schemas.length > 0
        ? projectFiles
            .map((f) => {
              let best = assessFileCompatibility(f.name, f.content, schemas[0]!, locale);
              for (const s of schemas.slice(1)) {
                const candidate = assessFileCompatibility(f.name, f.content, s, locale);
                if (candidate.score > best.score) best = candidate;
              }
              return { name: f.name, level: best.level, score: best.score, reason: best.reason };
            })
            .filter((x) => x.level !== 'incompatible')
        : [];

    return textResult(
      JSON.stringify(
        {
          pluginId: id,
          name: entry.name,
          acceptsData:
            typeof entry.plugin.loadData === 'function' ||
            typeof entry.plugin.loadValidatedData === 'function',
          formats: entry.formats.map((f) => f.extension),
          schemas: schemas.map((s) => summarizeSchema(s, locale)),
          currentData,
          compatibleProjectFiles,
        },
        null,
        2,
      ),
    );
  },
  'Read plugin data schema',
);

// ---- Tool 2: set_plugin_data (mutating) ------------------------------------

const setPluginDataTool = makeTool(
  'set_plugin_data',
  'Replace or load new data directly into a plugin with strict Zod pre-validation. Prefer passing structured `rows` (array of row objects) for tabular plugins or `json` for JSON plugins; `content` (raw CSV/TSV/JSON/text) is also supported. If validation fails, structured row/column errors are returned so you can fix and retry. Optionally saves to project data and opens the docked online editor.',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Plugin id; defaults to the active plugin.' },
      schemaId: { type: 'string', description: 'Optional schema slot id (when plugin accepts multiple formats).' },
      rows: {
        type: 'array',
        description: 'Structured tabular rows, e.g. [{"x": 1, "y": 2.5}, {"x": 2, "y": 4.1}].',
        items: { type: 'object' },
      },
      json: {
        description: 'Structured JSON object or array for JSON-based plugins (e.g. network graph, 2D grid, GeoJSON).',
      },
      content: {
        type: 'string',
        description: 'Raw CSV/TSV/JSON/text data content (used when `rows` and `json` are omitted).',
      },
      fileName: {
        type: 'string',
        description: 'Optional dataset file name, e.g. "experiment.csv" or "graph.json".',
      },
      saveToProject: {
        type: 'boolean',
        description: 'Also save/update this dataset in the global project data files (default false).',
        default: false,
      },
      openEditor: {
        type: 'boolean',
        description: 'Open the docked online data editor so the user can visually inspect/tweak the data (default false).',
        default: false,
      },
    },
  },
  async (args): Promise<ToolResult> => {
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active — pass pluginId or activate one first');
    const entry = usePluginStore.getState().registry.find((e) => e.id === id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);

    const schemas = resolvePluginDataSchemas(entry.plugin.manifest);
    const hasRows = Array.isArray(args.rows);
    const hasJson = args.json !== undefined && args.json !== null;
    const hasContent = typeof args.content === 'string' && args.content.trim().length > 0;
    if (!hasRows && !hasJson && !hasContent) {
      return errorResult('provide at least one of "rows", "json", or "content"');
    }

    const schema = pickTargetSchema(schemas, {
      schemaId: args.schemaId ? String(args.schemaId) : undefined,
      fileName: args.fileName ? String(args.fileName) : undefined,
      prefersJson: hasJson,
      prefersTabular: hasRows,
    });

    // Serialize input payload into text.
    let text = '';
    if (hasRows) {
      const rows = args.rows as Array<Record<string, unknown>>;
      if (rows.length > MAX_ROWS_WRITE) {
        return errorResult(`too many rows (${rows.length}, max ${MAX_ROWS_WRITE})`);
      }
      text =
        schema?.kind === 'tabular'
          ? serializeTabularRows(rows as TabularRow[], schema)
          : serializeGenericRowsToCsv(rows);
    } else if (hasJson) {
      text = JSON.stringify(args.json, null, 2);
    } else {
      text = String(args.content);
    }

    const defaultExt = schema?.extensions[0] ?? (hasJson ? '.json' : '.csv');
    const existingBinding = schema
      ? useDataEditorStore.getState().bindings[`${id}::${schema.id}`]
      : undefined;
    const rawFileName = args.fileName
      ? String(args.fileName).trim()
      : existingBinding?.fileName ?? `${id.replace(/^example\./, '')}-data${defaultExt}`;
    const fileName = rawFileName.includes('.') ? rawFileName : `${rawFileName}${defaultExt}`;

    // Pre-validate with Zod BEFORE touching the plugin or popping up UI modals,
    // so the LLM gets pinpoint row/column errors and can self-correct cleanly.
    const locale = getLocale();
    if (schema && schema.kind !== 'binary') {
      const { validatePluginDataText } = await import('@/core/data-schema/ingestion');
      const check = validatePluginDataText(text, schema, { fileName, locale });
      if (check.status === 'needs_mapping') {
        return errorResult(
          JSON.stringify(
            {
              error: 'column_mapping_required',
              message: 'Column headers do not match the plugin schema.',
              missingRequired: check.suggestion.missingRequired,
              sourceHeaders: check.parsed.headers,
              expectedColumns:
                schema.kind === 'tabular'
                  ? extractTabularColumns(schema).map((c) => ({
                      key: c.key,
                      required: c.required,
                      type: c.displayType,
                    }))
                  : [],
            },
            null,
            2,
          ),
        );
      }
      if (check.status === 'invalid') {
        return errorResult(
          JSON.stringify(
            {
              error: 'validation_failed',
              totalErrorCount: check.totalErrorCount,
              issues: check.issues.slice(0, 20),
              hint: 'Fix the offending rows/fields to satisfy the schema and retry set_plugin_data.',
            },
            null,
            2,
          ),
        );
      }
    }

    // Optionally persist to global project data.
    let savedFileId: string | undefined = existingBinding?.fileId;
    const saveToProject = args.saveToProject === true;
    if (saveToProject) {
      if (!isSupportedDataFileName(fileName)) {
        return errorResult(`unsupported project data file extension for "${fileName}"`);
      }
      await ensureProjectPreservingPlugin(id);
      const project = useProjectStore.getState().project;
      const existingFile = project?.data.files.find(
        (f) => f.id === savedFileId || f.name === fileName,
      );
      if (existingFile) {
        await useProjectStore.getState().updateDataFile(existingFile.id, text, id);
        savedFileId = existingFile.id;
      } else {
        const file = new File([text], fileName, {
          type: fileName.endsWith('.json') ? 'application/json' : 'text/csv',
        });
        savedFileId = (await useProjectStore.getState().addDataFile(file)) ?? undefined;
      }
    }

    const outcome = await useDataEditorStore.getState().ingestForPlugin({
      pluginId: id,
      schemaId: schema?.id,
      fileName,
      text,
      origin: saveToProject && savedFileId ? 'project-file' : 'online-editor',
      fileId: saveToProject ? savedFileId : undefined,
      silent: false,
    });

    if (!outcome.ok) {
      return errorResult(`failed to apply data to plugin "${id}"`);
    }

    syncOpenEditorIfMatching(
      id,
      schema,
      fileName,
      text,
      saveToProject ? savedFileId : undefined,
      args.openEditor === true,
    );

    return textResult(
      JSON.stringify(
        {
          ok: true,
          pluginId: id,
          fileName,
          savedToProject: Boolean(saveToProject && savedFileId),
          ...(savedFileId && saveToProject ? { fileId: savedFileId } : {}),
          rows: hasRows ? (args.rows as unknown[]).length : undefined,
          scienceOutputs: readScienceMetricsForPlugin(id),
        },
        null,
        2,
      ),
    );
  },
  'Set plugin data',
);

// ---- Tool 3: patch_plugin_data (mutating) ----------------------------------

type PatchOperation =
  | { op: 'set_cell'; row: number; column: string; value: TabularCellScalar }
  | { op: 'update_row'; row: number; values: Record<string, TabularCellScalar> }
  | { op: 'append_rows'; rows: Array<Record<string, TabularCellScalar>> }
  | { op: 'delete_rows'; rows: number[] };

const patchPluginDataTool = makeTool(
  'patch_plugin_data',
  'Apply surgical edits (set_cell, update_row, append_rows, delete_rows — all 1-based row numbers) to a tabular plugin\'s currently loaded dataset without regenerating the entire table. Validates the full patched table with Zod before committing.',
  {
    type: 'object',
    properties: {
      pluginId: { type: 'string', description: 'Plugin id; defaults to the active plugin.' },
      operations: {
        type: 'array',
        description:
          'Ordered list of patch ops: {"op":"set_cell","row":1,"column":"x","value":6.5}, {"op":"update_row","row":2,"values":{"y":3.1}}, {"op":"append_rows","rows":[{"x":5,"y":9}]}, {"op":"delete_rows","rows":[4]}.',
        items: { type: 'object' },
      },
      saveToProject: {
        type: 'boolean',
        description: 'Persist the patched table back to the bound project data file (default false).',
        default: false,
      },
    },
    required: ['operations'],
  },
  async (args): Promise<ToolResult> => {
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active — pass pluginId or activate one first');
    const entry = usePluginStore.getState().registry.find((e) => e.id === id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);

    const ops = args.operations as PatchOperation[];
    if (!Array.isArray(ops) || ops.length === 0) {
      return errorResult('"operations" must be a non-empty array');
    }

    const schemas = resolvePluginDataSchemas(entry.plugin.manifest);
    const tabularSchema = schemas.find((s): s is TabularDataSchema => s.kind === 'tabular') ?? null;

    const editorState = useDataEditorStore.getState();
    const binding = tabularSchema
      ? editorState.bindings[`${id}::${tabularSchema.id}`]
      : Object.values(editorState.bindings).find((b) => b.pluginId === id);

    const currentText =
      editorState.editorSession?.pluginId === id
        ? editorState.editorSession.text
        : binding?.lastAppliedText;

    if (!currentText || !currentText.trim()) {
      return errorResult(
        `plugin "${id}" has no loaded tabular data to patch — call set_plugin_data or load_data_file_to_plugin first`,
      );
    }

    const parsed = parseRawTabularText(currentText, tabularSchema ?? undefined);
    if (parsed.headers.length === 0) {
      return errorResult('current plugin data could not be parsed as a table');
    }

    // Build mutable row objects keyed by header name.
    const rows: Array<Record<string, TabularCellScalar>> = parsed.rows.map((cells) => {
      const obj: Record<string, TabularCellScalar> = {};
      parsed.headers.forEach((h, idx) => {
        obj[h] = cells[idx] ?? '';
      });
      return obj;
    });
    const beforeCount = rows.length;

    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      if (!op || typeof op !== 'object') {
        return errorResult(`operations[${i}] must be an object`);
      }
      if (op.op === 'set_cell') {
        const rIdx = Number(op.row) - 1;
        if (!Number.isInteger(rIdx) || rIdx < 0 || rIdx >= rows.length) {
          return errorResult(`operations[${i}]: row ${String(op.row)} is out of range (1..${rows.length})`);
        }
        if (typeof op.column !== 'string' || !op.column) {
          return errorResult(`operations[${i}]: "column" must be a non-empty string`);
        }
        rows[rIdx]![op.column] = op.value ?? '';
      } else if (op.op === 'update_row') {
        const rIdx = Number(op.row) - 1;
        if (!Number.isInteger(rIdx) || rIdx < 0 || rIdx >= rows.length) {
          return errorResult(`operations[${i}]: row ${String(op.row)} is out of range (1..${rows.length})`);
        }
        if (!op.values || typeof op.values !== 'object' || Array.isArray(op.values)) {
          return errorResult(`operations[${i}]: "values" must be an object`);
        }
        Object.assign(rows[rIdx]!, op.values);
      } else if (op.op === 'append_rows') {
        if (!Array.isArray(op.rows) || op.rows.length === 0) {
          return errorResult(`operations[${i}]: "rows" must be a non-empty array`);
        }
        for (const r of op.rows) {
          rows.push({ ...r });
        }
      } else if (op.op === 'delete_rows') {
        if (!Array.isArray(op.rows) || op.rows.length === 0) {
          return errorResult(`operations[${i}]: "rows" must be a non-empty array of 1-based row numbers`);
        }
        const toDrop = new Set<number>();
        for (const n of op.rows) {
          const idx = Number(n) - 1;
          if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) {
            return errorResult(`operations[${i}]: delete row ${String(n)} is out of range (1..${rows.length})`);
          }
          toDrop.add(idx);
        }
        const kept = rows.filter((_, idx) => !toDrop.has(idx));
        rows.length = 0;
        rows.push(...kept);
      } else {
        return errorResult(
          `operations[${i}]: unknown op "${String((op as { op?: unknown }).op)}" (use set_cell, update_row, append_rows, delete_rows)`,
        );
      }
    }

    const nextText = tabularSchema
      ? serializeTabularRows(rows, tabularSchema)
      : serializeGenericRowsToCsv(rows);
    const fileName =
      editorState.editorSession?.pluginId === id
        ? editorState.editorSession.fileName
        : binding?.fileName ?? `${id.replace(/^example\./, '')}-data.csv`;

    // Validate patched table with Zod before mutating plugin state.
    const locale = getLocale();
    if (tabularSchema) {
      const { validatePluginDataText } = await import('@/core/data-schema/ingestion');
      const check = validatePluginDataText(nextText, tabularSchema, { fileName, locale });
      if (check.status === 'invalid') {
        return errorResult(
          JSON.stringify(
            {
              error: 'validation_failed',
              totalErrorCount: check.totalErrorCount,
              issues: check.issues.slice(0, 20),
              hint: 'Patch was NOT applied because the resulting table violated the plugin schema.',
            },
            null,
            2,
          ),
        );
      }
    }

    let fileId = binding?.fileId;
    const saveToProject = args.saveToProject === true;
    if (saveToProject) {
      await ensureProjectPreservingPlugin(id);
      if (fileId) {
        await useProjectStore.getState().updateDataFile(fileId, nextText, id);
      } else {
        const f = new File([nextText], fileName, { type: 'text/csv' });
        fileId = (await useProjectStore.getState().addDataFile(f)) ?? undefined;
      }
    }

    const outcome = await useDataEditorStore.getState().ingestForPlugin({
      pluginId: id,
      schemaId: tabularSchema?.id,
      fileName,
      text: nextText,
      origin: saveToProject && fileId ? 'project-file' : 'online-editor',
      fileId: saveToProject ? fileId : binding?.fileId,
      silent: false,
    });

    if (!outcome.ok) {
      return errorResult(`failed to apply patched data to plugin "${id}"`);
    }

    syncOpenEditorIfMatching(
      id,
      tabularSchema,
      fileName,
      nextText,
      saveToProject ? fileId : binding?.fileId,
      false,
    );

    return textResult(
      JSON.stringify(
        {
          ok: true,
          pluginId: id,
          fileName,
          appliedOperations: ops.length,
          beforeRows: beforeCount,
          afterRows: rows.length,
          savedToProject: Boolean(saveToProject && fileId),
          scienceOutputs: readScienceMetricsForPlugin(id),
        },
        null,
        2,
      ),
    );
  },
  'Patch plugin data',
);

// ---- Tool 4: load_data_file_to_plugin (mutating) ---------------------------

const loadDataFileToPluginTool = makeTool(
  'load_data_file_to_plugin',
  'Load an existing project or example data file (from list_data_files) into a plugin with schema validation and optional explicit columnMapping (`{ targetColumnKey: sourceHeaderName }`). If headers differ, returns source headers so you can immediately retry with columnMapping.',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Data file name returned by list_data_files.' },
      pluginId: { type: 'string', description: 'Target plugin id; defaults to the active plugin.' },
      schemaId: { type: 'string', description: 'Optional schema slot id.' },
      columnMapping: {
        type: 'object',
        description: 'Optional mapping from target schema column key to source CSV header name.',
      },
      skipInvalidRows: {
        type: 'boolean',
        description: 'Skip rows that fail Zod validation instead of aborting (default false).',
        default: false,
      },
    },
    required: ['path'],
  },
  async (args): Promise<ToolResult> => {
    const path = String(args.path ?? '');
    const id = args.pluginId ? String(args.pluginId) : usePluginStore.getState().activeId;
    if (!id) return errorResult('no plugin is active — pass pluginId or activate one first');
    const entry = usePluginStore.getState().registry.find((e) => e.id === id);
    if (!entry?.plugin) return errorResult(`plugin "${id}" is not loaded`);

    const projectFile = useProjectStore
      .getState()
      .project?.data.files.find((f) => f.name === path);
    const text = projectFile ? projectFile.content : await resolveDataFile(path);
    if (text === undefined) return errorResult(`no data file named "${path}"`);

    const schemas = resolvePluginDataSchemas(entry.plugin.manifest);
    const schema = pickTargetSchema(schemas, {
      schemaId: args.schemaId ? String(args.schemaId) : undefined,
      fileName: path,
    });
    const mapping =
      args.columnMapping && typeof args.columnMapping === 'object' && !Array.isArray(args.columnMapping)
        ? (args.columnMapping as Record<string, string>)
        : undefined;
    const skipInvalidRows = args.skipInvalidRows === true;
    const locale = getLocale();

    // Pre-check so the LLM receives actionable JSON instead of opening a UI modal.
    if (schema && schema.kind !== 'binary') {
      const { validatePluginDataText } = await import('@/core/data-schema/ingestion');
      const check = validatePluginDataText(text, schema, {
        fileName: path,
        locale,
        columnMapping: mapping,
        skipInvalidRows,
      });
      if (check.status === 'needs_mapping') {
        return errorResult(
          JSON.stringify(
            {
              error: 'column_mapping_required',
              fileName: path,
              sourceHeaders: check.parsed.headers,
              sourceStats: check.suggestion.sourceStats,
              suggestedMapping: check.suggestion.mapping,
              missingRequired: check.suggestion.missingRequired,
              hint: 'Retry load_data_file_to_plugin with an explicit columnMapping object.',
            },
            null,
            2,
          ),
        );
      }
      if (check.status === 'invalid') {
        return errorResult(
          JSON.stringify(
            {
              error: 'validation_failed',
              fileName: path,
              totalErrorCount: check.totalErrorCount,
              issues: check.issues.slice(0, 20),
              hint: 'Pass skipInvalidRows: true to drop invalid rows, or fix the file with write_data_file.',
            },
            null,
            2,
          ),
        );
      }
    }

    const outcome = await useDataEditorStore.getState().ingestForPlugin({
      pluginId: id,
      schemaId: schema?.id,
      fileName: path,
      text,
      origin: projectFile ? 'project-file' : 'example',
      fileId: projectFile?.id,
      columnMapping: mapping,
      skipInvalidRows,
    });

    if (!outcome.ok) return errorResult(`failed to load "${path}" into "${id}"`);

    return textResult(
      JSON.stringify(
        {
          ok: true,
          pluginId: id,
          fileName: path,
          skippedRows: outcome.skippedRows ?? 0,
          scienceOutputs: readScienceMetricsForPlugin(id),
        },
        null,
        2,
      ),
    );
  },
  'Load data file to plugin',
);

// ---- Tool 5: write_data_file (mutating, overwrite-guarded) -----------------

const writeDataFileTool = makeTool(
  'write_data_file',
  'Create or update a global project data file (CSV, TSV, JSON, DAT, etc., synced to VFS data/ and shared across all plugins, Code/Flow modes, and Labs). Requires overwrite: true to replace an existing file of the same name.',
  {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'File name with supported text data extension, e.g. "experiment.csv" or "network.json".',
      },
      content: { type: 'string', description: 'Raw text content (CSV/TSV/JSON/text).' },
      rows: {
        type: 'array',
        description: 'Optional array of row objects (automatically serialized to RFC4180 CSV).',
        items: { type: 'object' },
      },
      json: { description: 'Optional JSON object or array (automatically formatted as JSON).' },
      overwrite: {
        type: 'boolean',
        description: 'Must be true to overwrite an existing project data file (default false).',
        default: false,
      },
      loadIntoActivePlugin: {
        type: 'boolean',
        description: 'Also load this file into the currently active plugin after saving (default false).',
        default: false,
      },
    },
    required: ['name'],
  },
  async (args): Promise<ToolResult> => {
    const rawName = String(args.name ?? '').trim();
    if (!rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) {
      return errorResult('"name" must be a plain file name without path separators');
    }
    if (!isSupportedDataFileName(rawName)) {
      return errorResult(
        `unsupported data file extension for "${rawName}" (use .csv, .tsv, .json, .dat, .txt, .xyz, .geojson, etc.)`,
      );
    }

    let text = '';
    if (Array.isArray(args.rows)) {
      if (args.rows.length > MAX_ROWS_WRITE) {
        return errorResult(`too many rows (${args.rows.length}, max ${MAX_ROWS_WRITE})`);
      }
      text = serializeGenericRowsToCsv(args.rows as Array<Record<string, unknown>>);
    } else if (args.json !== undefined && args.json !== null) {
      text = JSON.stringify(args.json, null, 2);
    } else if (typeof args.content === 'string') {
      text = args.content;
    } else {
      return errorResult('provide one of "content", "rows", or "json"');
    }

    if (!text.trim()) return errorResult('file content is empty');

    await ensureProjectPreservingPlugin(usePluginStore.getState().activeId);
    const project = useProjectStore.getState().project;
    if (!project) return errorResult('no project is open and creating one failed');

    const existing = project.data.files.find((f) => f.name === rawName);
    if (existing && args.overwrite !== true) {
      return errorResult(
        `project data file "${rawName}" already exists. Ask the user to confirm overwriting it (then retry with overwrite: true) or choose a new file name.`,
      );
    }

    let fileId: string | null = null;
    if (existing) {
      const ok = await useProjectStore.getState().updateDataFile(existing.id, text);
      if (!ok) return errorResult(`failed to update "${rawName}"`);
      fileId = existing.id;
    } else {
      const mime = rawName.endsWith('.json') ? 'application/json' : 'text/csv';
      fileId = await useProjectStore
        .getState()
        .addDataFile(new File([text], rawName, { type: mime }));
    }

    if (!fileId) return errorResult(`failed to save "${rawName}"`);

    let loadedInto: string | null = null;
    if (args.loadIntoActivePlugin === true) {
      const activeId = usePluginStore.getState().activeId;
      if (activeId) {
        const outcome = await useDataEditorStore.getState().ingestForPlugin({
          pluginId: activeId,
          fileName: rawName,
          text,
          origin: 'project-file',
          fileId,
        });
        if (outcome.ok) loadedInto = activeId;
      }
    }

    return textResult(
      JSON.stringify(
        {
          ok: true,
          fileId,
          name: rawName,
          overwritten: Boolean(existing),
          bytes: new TextEncoder().encode(text).byteLength,
          ...(loadedInto ? { loadedIntoPlugin: loadedInto } : {}),
        },
        null,
        2,
      ),
    );
  },
  'Write project data file',
);

export const DATA_HOST_TOOLS: readonly RegisteredTool[] = [
  getPluginDataSchemaTool,
  setPluginDataTool,
  patchPluginDataTool,
  loadDataFileToPluginTool,
  writeDataFileTool,
];
