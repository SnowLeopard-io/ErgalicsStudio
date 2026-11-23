// ==========================================================================
// Ergalics Studio — Reverse Compiler: Canonical JSON Schema -> Zod v4
//
// Compiles pure-JSON `ErgalicsJsonSchema` definitions (from static manifests,
// presets, or third-party `.cspkg` packages) into Zod v4 runtime validators
// via native `z.fromJSONSchema()` + strict scientific tabular cell coercion.
//
// CRITICAL SCIENTIFIC SAFETY RULE:
// Never use `z.coerce.number()` for CSV/TSV cells — JS `Number("") === 0`
// and `Number("   ") === 0` silently corrupt missing measurements into zeros.
// All tabular coercion uses strict grammar checks (`parseNumericText`).
// ==========================================================================

import { z } from 'zod';
import { parseNumericText } from '@/core/validation/parse';
import type {
  ErgalicsJsonSchema,
  JsonDataSchema,
  TabularDataSchema,
  TabularRow,
} from '@/types/dataSchema';
import { assertSafeJsonSchema } from './schema-guard';

/** Cache compiled Zod schemas by JSON Schema object reference. */
const jsonZodCache = new WeakMap<ErgalicsJsonSchema, z.ZodType>();
const tabularRowZodCache = new WeakMap<TabularDataSchema, z.ZodType<TabularRow>>();
const tabularCellZodCache = new WeakMap<ErgalicsJsonSchema, { req: z.ZodType; opt: z.ZodType }>();

/** Common scientific missing-value sentinels in CSV/TSV files. */
const NUMERIC_MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-']);
const BOOL_TRUE_TOKENS = new Set(['true', '1', 'yes', 'y']);
const BOOL_FALSE_TOKENS = new Set(['false', '0', 'no', 'n']);

interface FieldExpectation {
  allowsNumber: boolean;
  allowsInteger: boolean;
  allowsBoolean: boolean;
  allowsString: boolean;
  allowsNull: boolean;
}

/** Determine which primitive types a column JSON Schema accepts. */
function analyzeFieldExpectation(schema: ErgalicsJsonSchema): FieldExpectation {
  const out: FieldExpectation = {
    allowsNumber: false,
    allowsInteger: false,
    allowsBoolean: false,
    allowsString: false,
    allowsNull: false,
  };

  const visit = (node: ErgalicsJsonSchema) => {
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    for (const t of types) {
      if (t === 'number') out.allowsNumber = true;
      if (t === 'integer') {
        out.allowsInteger = true;
        out.allowsNumber = true;
      }
      if (t === 'boolean') out.allowsBoolean = true;
      if (t === 'string') out.allowsString = true;
      if (t === 'null') out.allowsNull = true;
    }
    if (node.enum) {
      for (const v of node.enum) {
        if (typeof v === 'number') {
          out.allowsNumber = true;
          if (Number.isInteger(v)) out.allowsInteger = true;
        } else if (typeof v === 'boolean') {
          out.allowsBoolean = true;
        } else if (typeof v === 'string') {
          out.allowsString = true;
        } else if (v === null) {
          out.allowsNull = true;
        }
      }
    }
    if (node.const !== undefined) {
      if (typeof node.const === 'number') out.allowsNumber = true;
      else if (typeof node.const === 'boolean') out.allowsBoolean = true;
      else if (typeof node.const === 'string') out.allowsString = true;
      else if (node.const === null) out.allowsNull = true;
    }
    for (const branch of [...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? [])]) {
      visit(branch);
    }
  };

  visit(schema);
  return out;
}

/**
 * Strictly coerce a single raw tabular cell (typically a string from CSV or
 * the online spreadsheet editor) according to its column JSON Schema.
 *
 * - Blank/missing cells never turn into `0`; they become `null` (when
 *   nullable), `schema.default` (when `missingPolicy === 'impute-default'`),
 *   or `undefined` (letting Zod enforce required vs optional cleanly).
 * - Invalid numeric strings stay as raw strings so Zod reports a precise
 *   type mismatch with the offending token intact.
 */
export function coerceTabularCell(
  raw: unknown,
  colSchema: ErgalicsJsonSchema,
): unknown {
  const expect = analyzeFieldExpectation(colSchema);
  const meta = colSchema['x-ergalics'];

  const resolveMissing = (): unknown => {
    if (meta?.missingPolicy === 'impute-default' && colSchema.default !== undefined) {
      return colSchema.default;
    }
    if (expect.allowsNull) return null;
    return undefined;
  };

  if (raw === undefined) return resolveMissing();
  if (raw === null) return expect.allowsNull ? null : resolveMissing();

  // Already typed scalars (e.g. from sampleRows or programmatic input)
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : raw;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();

  // Empty string is always missing (even for string columns, so required strings catch empty cells)
  if (trimmed.length === 0) {
    return resolveMissing();
  }

  // Numeric/boolean columns treat scientific missing sentinels ('NA', 'NaN', 'null', '-') as missing
  if (!expect.allowsString && NUMERIC_MISSING_TOKENS.has(trimmed.toLowerCase())) {
    return resolveMissing();
  }

  // Try strict numeric parsing when column accepts numbers
  if (expect.allowsNumber) {
    const parsed = parseNumericText(trimmed);
    if (parsed.ok) return parsed.value;
    // If column also accepts string (e.g. time: number | string ISO date), fall through to string
    if (expect.allowsString) return trimmed;
    // Otherwise keep invalid string so Zod emits a clean number-type error
    return trimmed;
  }

  // Try strict boolean parsing when column accepts booleans
  if (expect.allowsBoolean) {
    const lower = trimmed.toLowerCase();
    if (BOOL_TRUE_TOKENS.has(lower)) return true;
    if (BOOL_FALSE_TOKENS.has(lower)) return false;
    if (expect.allowsString) return trimmed;
    return trimmed;
  }

  return trimmed;
}

/** Coerce all cells of a raw tabular row object using `rowSchema.properties`. */
export function coerceTabularRow(
  rawRow: unknown,
  rowSchema: ErgalicsJsonSchema,
  allowExtraColumns = false,
): unknown {
  if (typeof rawRow !== 'object' || rawRow === null || Array.isArray(rawRow)) {
    return rawRow;
  }
  const src = rawRow as Record<string, unknown>;
  const props = rowSchema.properties ?? {};
  const out: Record<string, unknown> = {};

  for (const [key, colSchema] of Object.entries(props)) {
    const coerced = coerceTabularCell(src[key], colSchema);
    if (coerced !== undefined) {
      out[key] = coerced;
    }
  }

  if (allowExtraColumns) {
    for (const [key, value] of Object.entries(src)) {
      if (key in props) continue;
      if (value === undefined) continue;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) continue;
        const asNum = parseNumericText(trimmed);
        out[key] = asNum.ok ? asNum.value : trimmed;
      } else {
        out[key] = value;
      }
    }
  }

  return out;
}

/**
 * Compile any safe `ErgalicsJsonSchema` into a Zod v4 runtime validator using
 * Zod v4's native `z.fromJSONSchema()`. Cached by object reference.
 */
export function compileJsonSchemaToZod(schema: ErgalicsJsonSchema): z.ZodType {
  const cached = jsonZodCache.get(schema);
  if (cached) return cached;

  assertSafeJsonSchema(schema, 'compileJsonSchemaToZod');
  const compiled = z.fromJSONSchema(
    schema as unknown as Parameters<typeof z.fromJSONSchema>[0],
  );
  jsonZodCache.set(schema, compiled);
  return compiled;
}

/** Compile a `JsonDataSchema`'s document validator. */
export function compileJsonDocumentToZod(schema: JsonDataSchema): z.ZodType {
  return compileJsonSchemaToZod(schema.schema);
}

/**
 * Compile a `TabularDataSchema` row validator:
 * 1. Compiles `rowSchema` via native `z.fromJSONSchema()` (preserving all
 *    ranges, enums, patterns, formats, required fields, and `x-ergalics` meta).
 * 2. Wraps with `z.preprocess(coerceTabularRow, ...)` for safe CSV string coercion.
 */
export function compileTabularRowToZod(schema: TabularDataSchema): z.ZodType<TabularRow> {
  const cached = tabularRowZodCache.get(schema);
  if (cached) return cached;

  assertSafeJsonSchema(schema.rowSchema, 'compileTabularRowToZod');
  const allowExtra = schema.allowExtraColumns ?? false;
  const normalizedRowSchema: ErgalicsJsonSchema = {
    ...schema.rowSchema,
    additionalProperties: allowExtra,
  };
  const baseRowZod = z.fromJSONSchema(
    normalizedRowSchema as unknown as Parameters<typeof z.fromJSONSchema>[0],
  );
  const wrapped = z.preprocess(
    (raw) => coerceTabularRow(raw, schema.rowSchema, allowExtra),
    baseRowZod,
  ) as z.ZodType<TabularRow>;

  tabularRowZodCache.set(schema, wrapped);
  return wrapped;
}

/**
 * Compile a single tabular column validator for O(1) incremental cell
 * validation in the online table editor.
 */
export function compileTabularCellToZod(
  colSchema: ErgalicsJsonSchema,
  required: boolean,
): z.ZodType {
  let pair = tabularCellZodCache.get(colSchema);
  if (!pair) {
    assertSafeJsonSchema(colSchema, 'compileTabularCellToZod');
    const base = z.fromJSONSchema(
      colSchema as unknown as Parameters<typeof z.fromJSONSchema>[0],
    );
    const req = z.preprocess((raw) => coerceTabularCell(raw, colSchema), base);
    const opt = z.preprocess((raw) => coerceTabularCell(raw, colSchema), base.optional());
    pair = { req, opt };
    tabularCellZodCache.set(colSchema, pair);
  }
  return required ? pair.req : pair.opt;
}
