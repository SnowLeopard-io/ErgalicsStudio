// ==========================================================================
// Ergalics Studio — Plugin Data Schema Contracts (JSON Schema Draft 2020-12)
//
// Pure TypeScript types (zero runtime dependencies, zero Zod import) so
// `manifest.ts` files stay pure JSON data and never pull `zod` into the
// first-screen bundle. Runtime validation and bidirectional Zod <-> JSON
// Schema conversion live in `src/core/data-schema/` and load lazily.
// ==========================================================================

export type LocalizedText = Record<string, string>;

export type JsonSchemaPrimitiveType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object';

export type ErgalicsColumnRole =
  | 'x'
  | 'y'
  | 'z'
  | 'value'
  | 'color'
  | 'size'
  | 'error'
  | 'category'
  | 'group'
  | 'label'
  | 'time'
  | 'event'
  | 'source'
  | 'target'
  | 'weight'
  | 'lat'
  | 'lon'
  | 'id';

export type ErgalicsEditorHint =
  | 'number'
  | 'integer'
  | 'text'
  | 'select'
  | 'boolean'
  | 'date'
  | 'color';

/** Domain & GUI metadata embedded under JSON Schema's `x-ergalics` keyword. */
export interface ErgalicsFieldMeta {
  /** Locale-aware display label (preferred over JSON Schema `title`). */
  labelI18n?: LocalizedText;
  /** Locale-aware field description (preferred over JSON Schema `description`). */
  descriptionI18n?: LocalizedText;
  /** Case-insensitive header aliases for automatic column mapping (e.g. `['t', '时间']`). */
  aliases?: string[];
  /** Physical unit, e.g. `'s'`, `'K'`, `'m/s'`, `'mol/L'`. */
  unit?: string;
  /** Semantic role used for cross-plugin compatibility & column-mapping boosts. */
  role?: ErgalicsColumnRole;
  /** How missing/blank cells in this column should be handled during ingestion. */
  missingPolicy?: 'error' | 'skip-row' | 'impute-default';
  /** Hint for rendering cell controls in the online tabular editor. */
  editorHint?: ErgalicsEditorHint;
  /** Column display order (smaller numbers appear first). */
  order?: number;
}

/**
 * Canonical JSON Schema (Draft 2020-12) subset supported for bidirectional
 * `JSON Schema <-> Zod` compilation and Monaco JSON diagnostics.
 */
export interface ErgalicsJsonSchema {
  $schema?: 'https://json-schema.org/draft/2020-12/schema' | string;
  $id?: string;
  type?: JsonSchemaPrimitiveType | ReadonlyArray<JsonSchemaPrimitiveType>;
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  enum?: ReadonlyArray<string | number | boolean | null>;
  const?: string | number | boolean | null;
  // number / integer
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  // string
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'date' | 'date-time' | 'email' | 'uri' | 'uuid' | string;
  // array
  items?: ErgalicsJsonSchema;
  prefixItems?: ErgalicsJsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  // object
  properties?: Record<string, ErgalicsJsonSchema>;
  required?: string[];
  additionalProperties?: boolean | ErgalicsJsonSchema;
  // combinators
  oneOf?: ErgalicsJsonSchema[];
  anyOf?: ErgalicsJsonSchema[];
  allOf?: ErgalicsJsonSchema[];
  /** Ergalics GUI, unit, and column-mapping annotations. */
  'x-ergalics'?: ErgalicsFieldMeta;
}

export type TabularDelimiter = ',' | '\t' | ';' | 'whitespace';

export type TabularCellScalar = string | number | boolean | null;
export type TabularRow = Record<string, TabularCellScalar | undefined>;

interface BaseDataSchema {
  /** Slot identifier (`'primary'` for single-input plugins). */
  id: string;
  title: string;
  titleI18n?: LocalizedText;
  description?: string;
  descriptionI18n?: LocalizedText;
  /** Shared semantic preset id (enables cross-plugin dataset reuse). */
  presetId?: string;
  /** Accepted file extensions (e.g. `['.csv', '.tsv', '.dat']`). */
  extensions: string[];
  /**
   * Whether the docked online editor enables debounced live-sync to the canvas
   * by default. Defaults to `true` for lightweight visualizers; heavy solvers
   * should set `false`.
   */
  liveSync?: boolean;
}

/** 1. Tabular datasets (CSV / TSV / DAT / XYZ numeric tables). */
export interface TabularDataSchema extends BaseDataSchema {
  kind: 'tabular';
  /**
   * Row-level JSON Schema (`type: 'object'`, `properties` defines columns,
   * `required` defines required columns, `'x-ergalics'` carries UI metadata).
   */
  rowSchema: ErgalicsJsonSchema;
  minRows?: number;
  maxRows?: number;
  /** Preserve or tolerate columns not declared in `rowSchema.properties`. */
  allowExtraColumns?: boolean;
  /** Allow headerless numeric files (mapped positionally by column `order`). */
  allowHeaderless?: boolean;
  /** Accepted delimiters (defaults to comma, tab, semicolon, whitespace). */
  delimiters?: ReadonlyArray<TabularDelimiter>;
  /** Default serialization format when saving from the online editor. */
  defaultExportFormat?: 'csv' | 'tsv';
  /** Sample rows used for "Load Template" and initial online editor state. */
  sampleRows: TabularRow[];
}

/** 2. Structured JSON documents (graphs, trees, solver configs). */
export interface JsonDataSchema extends BaseDataSchema {
  kind: 'json';
  /** Document-level JSON Schema (Draft 2020-12). */
  schema: ErgalicsJsonSchema;
  /** Sample document used for template loading and online Monaco editing. */
  sample: unknown;
}

/** 3. Domain-specific text formats (FASTA, XYZ molecules, GPX, CIF, ...). */
export interface TextDataSchema extends BaseDataSchema {
  kind: 'text';
  /** Monaco language identifier (defaults to `'plaintext'`). */
  language?: string;
  grammarSummary?: string;
  grammarSummaryI18n?: LocalizedText;
  /** Optional JSON Schema validating the raw text string or line structure. */
  schema?: ErgalicsJsonSchema;
  /** Optional builtin domain validator id (e.g. `'fasta'`, `'xyz-mol'`). */
  builtinValidator?: string;
  sampleText: string;
}

/** 4. Binary assets (images, 3D meshes, audio, DICOM — not text-editable). */
export interface BinaryDataSchema extends BaseDataSchema {
  kind: 'binary';
  mimeTypes: string[];
  maxBytes?: number;
}

export type PluginDataSchema =
  | TabularDataSchema
  | JsonDataSchema
  | TextDataSchema
  | BinaryDataSchema;

/** Reference to a shared preset in `src/core/data-schema/presets.ts`. */
export interface PluginDataSchemaPresetRef {
  preset: string;
  overrides?: Partial<
    Omit<TabularDataSchema, 'kind'> &
      Omit<JsonDataSchema, 'kind'> &
      Omit<TextDataSchema, 'kind'> &
      Omit<BinaryDataSchema, 'kind'>
  >;
}

/** Manifest-level declaration: inline schema or shared preset reference. */
export type PluginDataSchemaSpec = PluginDataSchema | PluginDataSchemaPresetRef;

export type DataSourceOrigin =
  | 'project-file'
  | 'upload'
  | 'online-editor'
  | 'example';

/** Structured payload passed to `Plugin.loadValidatedData`. */
export interface ValidatedDataPayload<T = unknown> {
  schemaId: string;
  kind: PluginDataSchema['kind'];
  /** Zod-validated & column-mapped data (`TabularRow[]`, parsed JSON, or text). */
  data: T;
  /** Normalized File representation for backwards-compatible `loadData(file)`. */
  file: File;
  source: {
    origin: DataSourceOrigin;
    fileId?: string;
    fileName: string;
    /** Target column key -> source column header name (tabular only). */
    columnMapping?: Record<string, string>;
    skippedRows?: number;
  };
}

/** Per-plugin live data binding tracked by `pluginStore`. */
export interface PluginDataBinding {
  pluginId: string;
  schemaId: string;
  origin: 'project-file' | 'draft' | 'example' | 'upload-ephemeral';
  fileId?: string;
  fileName: string;
  lastAppliedText: string;
  contentHash: string;
  columnMapping?: Record<string, string>;
  hasUnsavedDraft: boolean;
  updatedAt: number;
}

/** Structured, localized validation issue (row/column addressable). */
export type DataValidationCode =
  | 'parse.syntax'
  | 'parse.empty'
  | 'table.min_rows'
  | 'table.max_rows'
  | 'table.missing_column'
  | 'cell.required'
  | 'cell.type_number'
  | 'cell.type_integer'
  | 'cell.type_boolean'
  | 'cell.type_string'
  | 'cell.range_min'
  | 'cell.range_max'
  | 'cell.enum'
  | 'cell.pattern'
  | 'cell.format'
  | 'json.schema'
  | 'schema.invalid';

export interface DataValidationIssue {
  /** 1-based data row number (`null` for document/table-level issues). */
  row: number | null;
  /** Target column key or dot/bracket JSON path (e.g. `'nodes[2].weight'`). */
  field: string;
  /** Localized user-facing field label. */
  fieldLabel: string;
  code: DataValidationCode;
  severity: 'error' | 'warning';
  message: string;
  actual?: unknown;
  expected?: string;
}

/** Lightweight cached structural profile of a project/example data file. */
export interface DataFileProfile {
  hash: string;
  kind: 'tabular' | 'json' | 'text';
  headers?: string[];
  headerless?: boolean;
  columnTypes?: Record<string, string>;
  rowCount?: number;
  jsonRootType?: 'object' | 'array' | 'primitive';
}

export type CompatibilityLevel = 'compatible' | 'needs_mapping' | 'incompatible';

export interface CompatibilityAssessment {
  level: CompatibilityLevel;
  score: number;
  reason?: string;
  /** Suggested column mapping when `kind === 'tabular'`. */
  suggestedMapping?: Record<string, string>;
  missingRequired?: string[];
}
