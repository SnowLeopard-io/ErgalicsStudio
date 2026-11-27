// ==========================================================================
// Ergalics Studio — Unified Plugin Data Ingestion & Validation Pipeline
//
// Single validation gate shared by all 4 import entry points (right panel,
// global Data modal, canvas drag-drop, file-preview "open with plugin") and
// the online data editor. Never throws raw parser/Zod errors to the UI:
// returns a discriminated union (`ok` | `needs_mapping` | `invalid`).
// ==========================================================================

import { parseJsonText } from '@/core/validation/parse';
import type {
  DataSourceOrigin,
  DataValidationIssue,
  PluginDataSchema,
  TabularRow,
  ValidatedDataPayload,
} from '@ergalics/plugin-sdk/types';
import type { Plugin } from '@ergalics/plugin-sdk';
import {
  applyColumnMapping,
  parseRawTabularText,
  serializeTabularRows,
  suggestColumnMapping,
  type ColumnMappingSuggestion,
  type ParsedRawTable,
} from './column-mapper';
import { formatZodIssues } from './error-l10n';
import {
  compileJsonDocumentToZod,
  compileJsonSchemaToZod,
  compileTabularRowToZod,
} from './json-to-zod';

export interface ValidateDataOptions {
  fileName?: string;
  origin?: DataSourceOrigin;
  fileId?: string;
  locale?: string;
  /** Explicit targetKey -> sourceHeader mapping (bypasses auto-mapping gate). */
  columnMapping?: Record<string, string>;
  /** When true, rows failing Zod validation are skipped instead of blocking load. */
  skipInvalidRows?: boolean;
  /** Cap on detailed issue entries collected (default 200). */
  maxIssues?: number;
}

export type ValidationPipelineResult<T = unknown> =
  | {
      status: 'ok';
      payload: ValidatedDataPayload<T>;
      issues: DataValidationIssue[];
      skippedRows: number;
      mapping?: Record<string, string>;
      autoMappedNonExact?: boolean;
    }
  | {
      status: 'needs_mapping';
      parsed: ParsedRawTable;
      suggestion: ColumnMappingSuggestion;
      issues: DataValidationIssue[];
    }
  | {
      status: 'invalid';
      issues: DataValidationIssue[];
      totalErrorCount: number;
      parsed?: ParsedRawTable;
      suggestion?: ColumnMappingSuggestion;
    };

function defaultFileName(schema: PluginDataSchema): string {
  const ext = schema.extensions[0] ?? (schema.kind === 'json' ? '.json' : '.csv');
  return `${schema.id || 'data'}${ext}`;
}

/**
 * Validate raw text against a `PluginDataSchema` using the compiled Zod v4
 * validator. Returns a structured discriminated result — never throws.
 */
export function validatePluginDataText(
  text: string,
  schema: PluginDataSchema,
  opts: ValidateDataOptions = {},
): ValidationPipelineResult {
  const locale = opts.locale ?? 'zh-CN';
  const zh = locale.toLowerCase().startsWith('zh');
  const fileName = opts.fileName ?? defaultFileName(schema);
  const origin: DataSourceOrigin = opts.origin ?? 'upload';
  const maxIssues = opts.maxIssues ?? 200;

  if (schema.kind === 'binary') {
    return {
      status: 'invalid',
      totalErrorCount: 1,
      issues: [
        {
          row: null,
          field: '(root)',
          fieldLabel: schema.title,
          code: 'schema.invalid',
          severity: 'error',
          message: zh ? '二进制格式不支持文本校验' : 'Binary format cannot be validated as text',
        },
      ],
    };
  }

  if (text.trim().length === 0) {
    return {
      status: 'invalid',
      totalErrorCount: 1,
      issues: [
        {
          row: null,
          field: '(root)',
          fieldLabel: schema.titleI18n?.[locale] ?? schema.title,
          code: 'parse.empty',
          severity: 'error',
          message: zh ? '数据内容为空，请先录入或导入数据。' : 'Data content is empty.',
        },
      ],
    };
  }

  // ---- JSON schema validation ----
  if (schema.kind === 'json') {
    const parsed = parseJsonText<unknown>(text);
    if (!parsed.ok) {
      const details = parsed.error.details as { line?: number; column?: number } | undefined;
      return {
        status: 'invalid',
        totalErrorCount: 1,
        issues: [
          {
            row: details?.line ?? null,
            field: '(json)',
            fieldLabel: 'JSON',
            code: 'parse.syntax',
            severity: 'error',
            message: zh
              ? `JSON 语法错误${details?.line ? `（第 ${details.line} 行，第 ${details.column ?? 1} 列）` : ''}：${parsed.error.message}`
              : parsed.error.message,
          },
        ],
      };
    }

    const zodSchema = compileJsonDocumentToZod(schema);
    const res = zodSchema.safeParse(parsed.value);
    if (!res.success) {
      const issues = formatZodIssues(res.error.issues.slice(0, maxIssues), {
        row: null,
        rootSchema: schema.schema,
        locale,
        rawValue: parsed.value,
      });
      return {
        status: 'invalid',
        issues,
        totalErrorCount: res.error.issues.length,
      };
    }

    const normalizedText = JSON.stringify(res.data, null, 2);
    const file = new File([normalizedText], fileName.endsWith('.json') ? fileName : `${fileName}.json`, {
      type: 'application/json',
    });
    return {
      status: 'ok',
      issues: [],
      skippedRows: 0,
      payload: {
        schemaId: schema.id,
        kind: 'json',
        data: res.data,
        file,
        source: {
          origin,
          ...(opts.fileId ? { fileId: opts.fileId } : {}),
          fileName: file.name,
        },
      },
    };
  }

  // ---- Domain text validation ----
  if (schema.kind === 'text') {
    if (schema.schema) {
      const zodSchema = compileJsonSchemaToZod(schema.schema);
      const res = zodSchema.safeParse(text);
      if (!res.success) {
        const issues = formatZodIssues(res.error.issues.slice(0, maxIssues), {
          row: null,
          rootSchema: schema.schema,
          locale,
          rawValue: text,
        });
        return { status: 'invalid', issues, totalErrorCount: res.error.issues.length };
      }
    }
    const file = new File([text], fileName, { type: 'text/plain' });
    return {
      status: 'ok',
      issues: [],
      skippedRows: 0,
      payload: {
        schemaId: schema.id,
        kind: 'text',
        data: text,
        file,
        source: {
          origin,
          ...(opts.fileId ? { fileId: opts.fileId } : {}),
          fileName: file.name,
        },
      },
    };
  }

  // ---- Tabular validation + smart column mapping ----
  const parsed = parseRawTabularText(text, {
    delimiters: schema.delimiters,
    allowHeaderless: schema.allowHeaderless,
  });

  if (parsed.rows.length === 0) {
    return {
      status: 'invalid',
      totalErrorCount: 1,
      parsed,
      issues: [
        {
          row: null,
          field: '(table)',
          fieldLabel: schema.titleI18n?.[locale] ?? schema.title,
          code: 'table.min_rows',
          severity: 'error',
          message: zh ? '表格中不包含任何数据行。' : 'Table contains no data rows.',
        },
      ],
    };
  }

  const suggestion = suggestColumnMapping(parsed, schema);
  const effectiveMapping = opts.columnMapping ?? suggestion.mapping;

  // When caller did not explicitly supply a mapping and confidence is low / missing required,
  // ask the UI to show the interactive Column Mapping modal rather than throwing.
  if (!opts.columnMapping && suggestion.needsConfirmation) {
    return {
      status: 'needs_mapping',
      parsed,
      suggestion,
      issues: suggestion.missingRequired.map((colKey) => ({
        row: null,
        field: colKey,
        fieldLabel:
          schema.rowSchema.properties?.[colKey]?.['x-ergalics']?.labelI18n?.[locale] ??
          schema.rowSchema.properties?.[colKey]?.title ??
          colKey,
        code: 'table.missing_column',
        severity: 'warning',
        message: zh
          ? `未自动匹配到必填列「${colKey}」，请手动指定映射列`
          : `Required column "${colKey}" could not be auto-mapped`,
      })),
    };
  }

  // Verify required columns are mapped even when explicit mapping was provided.
  const requiredCols = schema.rowSchema.required ?? [];
  const missingExplicit = requiredCols.filter((k) => !effectiveMapping[k]);
  if (missingExplicit.length > 0) {
    return {
      status: 'invalid',
      totalErrorCount: missingExplicit.length,
      parsed,
      suggestion,
      issues: missingExplicit.map((colKey) => ({
        row: null,
        field: colKey,
        fieldLabel:
          schema.rowSchema.properties?.[colKey]?.['x-ergalics']?.labelI18n?.[locale] ??
          schema.rowSchema.properties?.[colKey]?.title ??
          colKey,
        code: 'table.missing_column',
        severity: 'error',
        message: zh ? `缺少必填列映射：「${colKey}」` : `Missing mapping for required column "${colKey}"`,
      })),
    };
  }

  const mappedRawRows = applyColumnMapping(parsed, effectiveMapping, schema);
  const rowZod = compileTabularRowToZod(schema);
  const validRows: TabularRow[] = [];
  const collectedIssues: DataValidationIssue[] = [];
  let totalErrorCount = 0;
  let skippedRows = 0;

  for (let i = 0; i < mappedRawRows.length; i += 1) {
    const rawRow = mappedRawRows[i]!;
    const res = rowZod.safeParse(rawRow);
    if (res.success) {
      validRows.push(res.data);
    } else {
      const rowIssues = formatZodIssues(res.error.issues, {
        row: i + 1,
        rootSchema: schema.rowSchema,
        locale,
        rawValue: rawRow,
      });
      totalErrorCount += rowIssues.length;
      if (opts.skipInvalidRows) {
        skippedRows += 1;
        for (const issue of rowIssues) {
          if (collectedIssues.length < maxIssues) {
            collectedIssues.push({ ...issue, severity: 'warning' });
          }
        }
      } else {
        for (const issue of rowIssues) {
          if (collectedIssues.length < maxIssues) {
            collectedIssues.push(issue);
          }
        }
      }
    }
  }

  if (!opts.skipInvalidRows && totalErrorCount > 0) {
    return {
      status: 'invalid',
      issues: collectedIssues,
      totalErrorCount,
      parsed,
      suggestion,
    };
  }

  // Row-count bounds checked after filtering skipped rows.
  if (schema.minRows !== undefined && validRows.length < schema.minRows) {
    const issue: DataValidationIssue = {
      row: null,
      field: '(table)',
      fieldLabel: schema.titleI18n?.[locale] ?? schema.title,
      code: 'table.min_rows',
      severity: 'error',
      message: zh
        ? `有效数据行不足（当前 ${validRows.length} 行，至少需要 ${schema.minRows} 行）`
        : `Not enough valid rows (${validRows.length}, need at least ${schema.minRows})`,
    };
    return {
      status: 'invalid',
      issues: [issue, ...collectedIssues].slice(0, maxIssues),
      totalErrorCount: totalErrorCount + 1,
      parsed,
      suggestion,
    };
  }

  if (schema.maxRows !== undefined && validRows.length > schema.maxRows) {
    const issue: DataValidationIssue = {
      row: null,
      field: '(table)',
      fieldLabel: schema.titleI18n?.[locale] ?? schema.title,
      code: 'table.max_rows',
      severity: 'error',
      message: zh
        ? `数据行数超过上限（当前 ${validRows.length} 行，上限 ${schema.maxRows} 行）`
        : `Too many rows (${validRows.length}, maximum ${schema.maxRows})`,
    };
    return {
      status: 'invalid',
      issues: [issue],
      totalErrorCount: 1,
      parsed,
      suggestion,
    };
  }

  const exportFmt = schema.defaultExportFormat ?? 'csv';
  const normalizedCsv = serializeTabularRows(validRows, schema, exportFmt);
  const mime = exportFmt === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
  const file = new File([normalizedCsv], fileName, { type: mime });

  return {
    status: 'ok',
    issues: collectedIssues,
    skippedRows,
    mapping: effectiveMapping,
    autoMappedNonExact: !opts.columnMapping && !suggestion.isExactHeaderMatch,
    payload: {
      schemaId: schema.id,
      kind: 'tabular',
      data: validRows,
      file,
      source: {
        origin,
        ...(opts.fileId ? { fileId: opts.fileId } : {}),
        fileName,
        columnMapping: effectiveMapping,
        ...(skippedRows > 0 ? { skippedRows } : {}),
      },
    },
  };
}

/**
 * Deliver a validated payload to a plugin:
 * - Prefers `plugin.loadValidatedData(payload)` when implemented;
 * - Falls back seamlessly to `plugin.loadData(payload.file)` so all legacy
 *   plugins work with zero modification.
 */
export async function deliverValidatedPayload(
  plugin: Plugin,
  payload: ValidatedDataPayload,
): Promise<void> {
  if (typeof plugin.loadValidatedData === 'function') {
    await plugin.loadValidatedData(payload);
    return;
  }
  if (typeof plugin.loadData === 'function') {
    await plugin.loadData(payload.file);
    return;
  }
  throw new Error(`Plugin "${plugin.manifest.id}" does not accept data input`);
}
