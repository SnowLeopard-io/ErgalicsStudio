// ==========================================================================
// Safe parsing of user-entered text
//
// Editor forms accept JSON and numbers as strings. `JSON.parse` throws an
// opaque SyntaxError ("Unexpected token…") and `Number('')` returns 0 while
// `Number('  ')` returns 0 — both silently corrupt research configuration.
// These parsers return either a typed value or a precise, field-ready error.
// ==========================================================================

import { DataError } from '@/core/errors/AppError';
import { err, ok } from '@/core/errors/result';
import type { Result } from '@/core/errors/result';

export interface JsonLocation {
  position: number;
  line: number;
  column: number;
  preview: string;
}

/** Translate a character offset into a 1-based line/column + source preview. */
export function locateTextOffset(text: string, position: number): JsonLocation {
  const upto = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const line = (upto.match(/\n/g)?.length ?? 0) + 1;
  const lastBreak = upto.lastIndexOf('\n');
  const column = upto.length - lastBreak; // 1-based
  const lineStart = lastBreak + 1;
  let lineEnd = text.indexOf('\n', lineStart);
  if (lineEnd < 0) lineEnd = text.length;
  const preview = text.slice(lineStart, lineEnd).replace(/\s+$/u, '');
  return { position, line, column, preview };
}

const POSITION_PATTERNS = [/at position (\d+)/i, /position\s+(\d+)/i];

function extractPosition(message: string): number | null {
  for (const pattern of POSITION_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const pos = Number(match[1]);
      return Number.isInteger(pos) ? pos : null;
    }
  }
  return null;
}

/**
 * Strict JSON parse. Empty/blank input is a `data.json_empty` error (silently
 * returning `undefined` previously wiped baseParams). The returned DataError
 * carries `details.offset/line/column/preview` for inline display.
 */
export function parseJsonText<T = unknown>(text: string): Result<T, DataError> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return err(
      new DataError('JSON content is empty', {
        code: 'data.json_empty',
        details: { offset: 0 },
      }),
    );
  }
  try {
    return ok(JSON.parse(trimmed) as T);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const offset = extractPosition(message);
    const location = offset === null ? undefined : locateTextOffset(trimmed, offset);
    return err(
      new DataError(location ? `Invalid JSON at line ${location.line}, column ${location.column}` : message, {
        code: 'data.format',
        cause: caught,
        details: {
          offset,
          ...(location ? { line: location.line, column: location.column, preview: location.preview } : {}),
        },
      }),
    );
  }
}

/** Parse + require a plain JSON object (research params/config editor). */
export function parseJsonObject(text: string): Result<Record<string, unknown>, DataError> {
  const parsed = parseJsonText<unknown>(text);
  if (!parsed.ok) return parsed;
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return err(
      new DataError('Expected a JSON object, e.g. { "key": 1 }', {
        code: 'data.format',
        details: { actualType: Array.isArray(parsed.value) ? 'array' : typeof parsed.value },
      }),
    );
  }
  return ok(parsed.value as Record<string, unknown>);
}

// ---- numeric text ----------------------------------------------------------

export type NumericTextResult =
  | { ok: true; value: number }
  | { ok: false; code: string; message: string };

export interface NumericTextOptions {
  integer?: boolean;
  min?: number;
  max?: number;
  field?: string;
}

/**
 * Parse a form field as a finite number. Unlike `Number(input)`:
 *   - blank/whitespace → `required` error (not 0),
 *   - `Infinity`, `NaN`, hex, trailing garbage → errors,
 *   - integer/range checks return stable codes.
 */
export function parseNumericText(input: string, options: NumericTextOptions = {}): NumericTextResult {
  const field = options.field ? `${options.field}: ` : '';
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 'required', message: `${field}a value is required` };
  }
  // Strict grammar: optional sign, digits (with optional decimal/exponent).
  // `Number('0x10')`/`Number('1e')` surprises are rejected explicitly.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return { ok: false, code: 'number.format', message: `${field}“${trimmed}” is not a valid number` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, code: 'number.finite', message: `${field}must be a finite number` };
  }
  if (options.integer && !Number.isInteger(value)) {
    return { ok: false, code: 'number.integer', message: `${field}must be an integer` };
  }
  if (options.min !== undefined && value < options.min) {
    return { ok: false, code: 'number.min', message: `${field}must be >= ${options.min}` };
  }
  if (options.max !== undefined && value > options.max) {
    return { ok: false, code: 'number.max', message: `${field}must be <= ${options.max}` };
  }
  return { ok: true, value };
}
