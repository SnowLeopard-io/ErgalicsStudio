// ==========================================================================
// Ergalics Studio — Localized Zod Issue Formatter
//
// Translates Zod v4 validation issues into structured, bilingual
// `DataValidationIssue` entries carrying 1-based row indices, localized
// column labels (from `x-ergalics.labelI18n`), and actionable messages.
// ==========================================================================

import type { z } from 'zod';
import type {
  DataValidationCode,
  DataValidationIssue,
  ErgalicsJsonSchema,
} from '@ergalics/plugin-sdk/types';

function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith('zh');
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') {
      out += `[${seg}]`;
    } else {
      const s = String(seg);
      out += out.length === 0 ? s : `.${s}`;
    }
  }
  return out || '(root)';
}

function lookupFieldSchema(
  root: ErgalicsJsonSchema | undefined,
  path: ReadonlyArray<PropertyKey>,
): ErgalicsJsonSchema | undefined {
  let cur = root;
  for (const seg of path) {
    if (!cur) return undefined;
    if (typeof seg === 'number') {
      cur = cur.items;
    } else {
      cur = cur.properties?.[String(seg)];
    }
  }
  return cur;
}

function resolveFieldLabel(
  fieldPath: string,
  fieldSchema: ErgalicsJsonSchema | undefined,
  locale: string,
): string {
  if (!fieldSchema) return fieldPath;
  return fieldSchema['x-ergalics']?.labelI18n?.[locale] ?? fieldSchema.title ?? fieldPath;
}

function formatActual(val: unknown): string {
  if (val === undefined || val === null || val === '') return '空值';
  return String(val);
}

function formatActualEn(val: unknown): string {
  if (val === undefined || val === null || val === '') return 'empty';
  return String(val);
}

/**
 * Convert Zod v4 issues into localized `DataValidationIssue[]`.
 *
 * @param issues Raw `zodError.issues`
 * @param opts   Row index (1-based for tabular, `null` for JSON), root schema,
 *               locale, and optional raw input record for showing actual value.
 */
export function formatZodIssues(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  opts: {
    row: number | null;
    rootSchema?: ErgalicsJsonSchema;
    locale?: string;
    rawValue?: unknown;
  },
): DataValidationIssue[] {
  const locale = opts.locale ?? 'zh-CN';
  const zh = isZhLocale(locale);
  const rowPrefix =
    opts.row !== null ? (zh ? `第 ${opts.row} 行` : `Row ${opts.row} `) : '';

  return issues.map((issue) => {
    const field = formatPath(issue.path);
    const fieldSchema = lookupFieldSchema(opts.rootSchema, issue.path);
    const fieldLabel = resolveFieldLabel(field, fieldSchema, locale);
    const rawRec =
      typeof opts.rawValue === 'object' && opts.rawValue !== null
        ? (opts.rawValue as Record<string, unknown>)
        : undefined;
    const actual =
      issue.path.length === 1 && rawRec ? rawRec[String(issue.path[0])] : undefined;

    const { code, message, expected } = classifyIssue(
      issue,
      rowPrefix,
      fieldLabel,
      actual,
      zh,
      fieldSchema,
    );

    return {
      row: opts.row,
      field,
      fieldLabel,
      code,
      severity: 'error',
      message,
      ...(actual !== undefined ? { actual } : {}),
      ...(expected !== undefined ? { expected } : {}),
    };
  });
}

function classifyIssue(
  issue: z.core.$ZodIssue,
  rowPrefix: string,
  fieldLabel: string,
  actual: unknown,
  zh: boolean,
  fieldSchema: ErgalicsJsonSchema | undefined,
): { code: DataValidationCode; message: string; expected?: string } {
  const label = zh ? `「${fieldLabel}」` : `"${fieldLabel}"`;
  const rec = issue as unknown as Record<string, unknown>;

  if (issue.code === 'invalid_type') {
    const expectedType = String(rec.expected ?? 'value');
    const isMissing = actual === undefined || actual === '' || rec.received === 'undefined';
    if (isMissing) {
      return {
        code: 'cell.required',
        expected: expectedType,
        message: zh
          ? `${rowPrefix}${label}为必填项，不能为空`
          : `${rowPrefix}${label} is required`,
      };
    }
    if (expectedType === 'number') {
      return {
        code: 'cell.type_number',
        expected: 'number',
        message: zh
          ? `${rowPrefix}${label}必须为有效数值（当前：${formatActual(actual)}）`
          : `${rowPrefix}${label} must be a valid number (got ${formatActualEn(actual)})`,
      };
    }
    if (expectedType === 'int' || expectedType === 'integer') {
      return {
        code: 'cell.type_integer',
        expected: 'integer',
        message: zh
          ? `${rowPrefix}${label}必须为整数（当前：${formatActual(actual)}）`
          : `${rowPrefix}${label} must be an integer (got ${formatActualEn(actual)})`,
      };
    }
    if (expectedType === 'boolean') {
      return {
        code: 'cell.type_boolean',
        expected: 'boolean',
        message: zh
          ? `${rowPrefix}${label}必须为布尔值 true/false（当前：${formatActual(actual)}）`
          : `${rowPrefix}${label} must be a boolean true/false (got ${formatActualEn(actual)})`,
      };
    }
    return {
      code: 'cell.type_string',
      expected: expectedType,
      message: zh
        ? `${rowPrefix}${label}类型应为 ${expectedType}（当前：${formatActual(actual)}）`
        : `${rowPrefix}${label} must be of type ${expectedType} (got ${formatActualEn(actual)})`,
    };
  }

  if (issue.code === 'too_small') {
    const min = rec.minimum;
    const inclusive = rec.inclusive !== false;
    const origin = String(rec.origin ?? '');
    if (origin === 'string') {
      if (min === 1) {
        return {
          code: 'cell.required',
          expected: 'non-empty string',
          message: zh
            ? `${rowPrefix}${label}不能为空文本`
            : `${rowPrefix}${label} must not be empty`,
        };
      }
      return {
        code: 'cell.range_min',
        expected: `length >= ${String(min)}`,
        message: zh
          ? `${rowPrefix}${label}长度至少为 ${String(min)} 个字符`
          : `${rowPrefix}${label} must be at least ${String(min)} characters`,
      };
    }
    if (origin === 'array') {
      return {
        code: 'table.min_rows',
        expected: `>= ${String(min)} items`,
        message: zh
          ? `${rowPrefix}${label}至少需要 ${String(min)} 项`
          : `${rowPrefix}${label} must contain at least ${String(min)} items`,
      };
    }
    const op = inclusive ? '≥' : '>';
    return {
      code: 'cell.range_min',
      expected: `${op} ${String(min)}`,
      message: zh
        ? `${rowPrefix}${label}必须 ${op} ${String(min)}（当前：${formatActual(actual)}）`
        : `${rowPrefix}${label} must be ${op} ${String(min)} (got ${formatActualEn(actual)})`,
    };
  }

  if (issue.code === 'too_big') {
    const max = rec.maximum;
    const inclusive = rec.inclusive !== false;
    const origin = String(rec.origin ?? '');
    if (origin === 'string') {
      return {
        code: 'cell.range_max',
        expected: `length <= ${String(max)}`,
        message: zh
          ? `${rowPrefix}${label}长度最多为 ${String(max)} 个字符`
          : `${rowPrefix}${label} must be at most ${String(max)} characters`,
      };
    }
    const op = inclusive ? '≤' : '<';
    return {
      code: 'cell.range_max',
      expected: `${op} ${String(max)}`,
      message: zh
        ? `${rowPrefix}${label}必须 ${op} ${String(max)}（当前：${formatActual(actual)}）`
        : `${rowPrefix}${label} must be ${op} ${String(max)} (got ${formatActualEn(actual)})`,
    };
  }

  if (issue.code === 'invalid_value' || issue.code === 'invalid_union') {
    const allowed = Array.isArray(rec.values)
      ? (rec.values as unknown[]).map(String).join(' / ')
      : fieldSchema?.enum
        ? fieldSchema.enum.map(String).join(' / ')
        : undefined;
    if (allowed) {
      return {
        code: 'cell.enum',
        expected: allowed,
        message: zh
          ? `${rowPrefix}${label}仅允许取值：${allowed}（当前：${formatActual(actual)}）`
          : `${rowPrefix}${label} must be one of: ${allowed} (got ${formatActualEn(actual)})`,
      };
    }
  }

  if (issue.code === 'invalid_format') {
    const fmt = String(rec.format ?? 'format');
    const code: DataValidationCode = fmt === 'regex' ? 'cell.pattern' : 'cell.format';
    return {
      code,
      expected: fmt,
      message: zh
        ? `${rowPrefix}${label}格式不符合要求（${fmt}）`
        : `${rowPrefix}${label} has invalid format (${fmt})`,
    };
  }

  return {
    code: 'json.schema',
    message: zh
      ? `${rowPrefix}${label}校验失败：${issue.message}`
      : `${rowPrefix}${label}: ${issue.message}`,
  };
}
