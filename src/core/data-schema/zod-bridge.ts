// ==========================================================================
// Ergalics Studio — Forward Bridge: Zod v4 -> Canonical JSON Schema
//
// Lets TypeScript plugin authors author schemas in Zod (getting compile-time
// `z.infer<typeof S>` types) and emit pure-JSON `PluginDataSchema` artifacts
// carrying `x-ergalics` GUI/mapping metadata.
// ==========================================================================

import { z } from 'zod';
import type {
  ErgalicsFieldMeta,
  ErgalicsJsonSchema,
  JsonDataSchema,
  LocalizedText,
  TabularDataSchema,
  TabularDelimiter,
  TabularRow,
} from '@/types/dataSchema';
import { assertSafeJsonSchema } from './schema-guard';

/**
 * Attach Ergalics GUI, unit, role, and column-mapping metadata to any Zod
 * schema via Zod v4's native `.meta(...)`, so `z.toJSONSchema()` emits it
 * under the standard `x-ergalics` extension keyword.
 */
export function col<T extends z.ZodType>(
  schema: T,
  meta: ErgalicsFieldMeta & { title?: string; description?: string },
): T {
  const { title, description, ...ergalicsMeta } = meta;
  const payload: Record<string, unknown> = {
    'x-ergalics': ergalicsMeta,
  };
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  return schema.meta(payload) as T;
}

export interface ZodToJsonSchemaOptions {
  /**
   * How to handle unrepresentable Zod features (e.g. `.transform()`, Date).
   * Defaults to `'throw'` so non-serializable schemas are caught early rather
   * than silently dropping validation rules in `.cspkg` manifests.
   */
  unrepresentable?: 'throw' | 'any';
}

/**
 * Convert a Zod v4 schema into a verified `ErgalicsJsonSchema` (Draft 2020-12),
 * preserving all `x-ergalics` metadata attached via `col()` / `.meta()`.
 */
export function zodToErgalicsJsonSchema(
  schema: z.ZodType,
  options: ZodToJsonSchemaOptions = {},
): ErgalicsJsonSchema {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: options.unrepresentable ?? 'throw',
  }) as ErgalicsJsonSchema;

  assertSafeJsonSchema(jsonSchema, 'zodToErgalicsJsonSchema');
  return jsonSchema;
}

export interface DefineTabularFromZodOptions<T extends z.ZodRawShape> {
  id: string;
  presetId?: string;
  title: string;
  titleI18n?: LocalizedText;
  description?: string;
  descriptionI18n?: LocalizedText;
  extensions: string[];
  rowZod: z.ZodObject<T>;
  minRows?: number;
  maxRows?: number;
  allowExtraColumns?: boolean;
  allowHeaderless?: boolean;
  delimiters?: ReadonlyArray<TabularDelimiter>;
  defaultExportFormat?: 'csv' | 'tsv';
  liveSync?: boolean;
  sampleRows: TabularRow[];
}

/** Build a pure-JSON `TabularDataSchema` from a Zod object row definition. */
export function defineTabularSchemaFromZod<T extends z.ZodRawShape>(
  opts: DefineTabularFromZodOptions<T>,
): TabularDataSchema {
  const rowSchema = zodToErgalicsJsonSchema(
    opts.allowExtraColumns ? opts.rowZod.loose() : opts.rowZod,
  );
  // Normalize Zod's `additionalProperties: {}` (from `.loose()`) to boolean `true`
  // for cleaner human-readable manifests and strict round-trip predictability.
  if (opts.allowExtraColumns) {
    rowSchema.additionalProperties = true;
  }
  return {
    id: opts.id,
    ...(opts.presetId ? { presetId: opts.presetId } : {}),
    kind: 'tabular',
    title: opts.title,
    ...(opts.titleI18n ? { titleI18n: opts.titleI18n } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.descriptionI18n ? { descriptionI18n: opts.descriptionI18n } : {}),
    extensions: opts.extensions,
    rowSchema,
    ...(opts.minRows !== undefined ? { minRows: opts.minRows } : {}),
    ...(opts.maxRows !== undefined ? { maxRows: opts.maxRows } : {}),
    ...(opts.allowExtraColumns !== undefined ? { allowExtraColumns: opts.allowExtraColumns } : {}),
    ...(opts.allowHeaderless !== undefined ? { allowHeaderless: opts.allowHeaderless } : {}),
    ...(opts.delimiters ? { delimiters: opts.delimiters } : {}),
    ...(opts.defaultExportFormat ? { defaultExportFormat: opts.defaultExportFormat } : {}),
    ...(opts.liveSync !== undefined ? { liveSync: opts.liveSync } : {}),
    sampleRows: opts.sampleRows,
  };
}

export interface DefineJsonFromZodOptions {
  id: string;
  presetId?: string;
  title: string;
  titleI18n?: LocalizedText;
  description?: string;
  descriptionI18n?: LocalizedText;
  extensions: string[];
  zod: z.ZodType;
  liveSync?: boolean;
  sample: unknown;
}

/** Build a pure-JSON `JsonDataSchema` from any serializable Zod schema. */
export function defineJsonSchemaFromZod(opts: DefineJsonFromZodOptions): JsonDataSchema {
  return {
    id: opts.id,
    ...(opts.presetId ? { presetId: opts.presetId } : {}),
    kind: 'json',
    title: opts.title,
    ...(opts.titleI18n ? { titleI18n: opts.titleI18n } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.descriptionI18n ? { descriptionI18n: opts.descriptionI18n } : {}),
    extensions: opts.extensions,
    schema: zodToErgalicsJsonSchema(opts.zod),
    ...(opts.liveSync !== undefined ? { liveSync: opts.liveSync } : {}),
    sample: opts.sample,
  };
}
