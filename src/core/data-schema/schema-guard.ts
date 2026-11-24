// ==========================================================================
// Ergalics Studio — Pure-TS structural & safety guard for PluginDataSchema
//
// Zero runtime dependencies (no Zod import), so `src/core/cspkg.ts` can
// validate untrusted `.cspkg` manifests at install time without pulling Zod
// into the core bundle, and `json-to-zod.ts` reuses the exact same checks
// before compiling a JSON Schema.
// ==========================================================================

import type {
  ErgalicsJsonSchema,
  PluginDataSchema,
  PluginDataSchemaSpec,
} from '@/types/dataSchema';

const MAX_SCHEMA_DEPTH = 12;
const MAX_PROPERTIES = 200;
const MAX_PATTERN_LENGTH = 512;
const ALLOWED_KINDS = new Set(['tabular', 'json', 'text', 'binary']);
const ALLOWED_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'array',
  'object',
]);

/**
 * Simple heuristic guard against catastrophic backtracking (ReDoS) in
 * untrusted JSON Schema `pattern` values: rejects nested quantifiers like
 * `(a+)+`, `([a-z]*)*`, `(a|aa)+` and overly long patterns.
 */
function assertSafeRegexPattern(pattern: string, path: string): void {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`${path}: regex pattern exceeds ${MAX_PATTERN_LENGTH} chars`);
  }
  // Reject nested quantifiers such as `(...+)+`, `(...*)+`, `(...{1,5})+`.
  if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(pattern)) {
    throw new Error(`${path}: unsafe nested quantifier in regex pattern`);
  }
  try {
    // Validate regex syntax eagerly.
    new RegExp(pattern);
  } catch (err) {
    throw new Error(
      `${path}: invalid regex pattern (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Validate an `ErgalicsJsonSchema` node recursively for structural sanity and
 * security (depth cap, no external `$ref`, safe regex patterns, valid types).
 */
export function assertSafeJsonSchema(
  node: unknown,
  path = 'schema',
  depth = 0,
): asserts node is ErgalicsJsonSchema {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(`${path}: JSON Schema exceeds maximum nesting depth (${MAX_SCHEMA_DEPTH})`);
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`${path}: JSON Schema node must be a plain object`);
  }
  const obj = node as Record<string, unknown>;

  // Disallow remote/arbitrary $ref in untrusted manifests (SSRF / resolver risk).
  if ('$ref' in obj && obj.$ref !== undefined) {
    throw new Error(`${path}: external or dynamic "$ref" is not supported in PluginDataSchema`);
  }

  if (obj.type !== undefined) {
    if (typeof obj.type === 'string') {
      if (!ALLOWED_TYPES.has(obj.type)) {
        throw new Error(`${path}.type: unsupported type "${obj.type}"`);
      }
    } else if (Array.isArray(obj.type)) {
      if (obj.type.length === 0) {
        throw new Error(`${path}.type: type array must not be empty`);
      }
      for (const t of obj.type) {
        if (typeof t !== 'string' || !ALLOWED_TYPES.has(t)) {
          throw new Error(`${path}.type: unsupported type "${String(t)}"`);
        }
      }
    } else {
      throw new Error(`${path}.type: must be a string or array of strings`);
    }
  }

  if (obj.pattern !== undefined) {
    if (typeof obj.pattern !== 'string') {
      throw new Error(`${path}.pattern: must be a string`);
    }
    assertSafeRegexPattern(obj.pattern, `${path}.pattern`);
  }

  if (obj.properties !== undefined) {
    if (typeof obj.properties !== 'object' || obj.properties === null || Array.isArray(obj.properties)) {
      throw new Error(`${path}.properties: must be an object`);
    }
    const entries = Object.entries(obj.properties as Record<string, unknown>);
    if (entries.length > MAX_PROPERTIES) {
      throw new Error(`${path}.properties: exceeds maximum ${MAX_PROPERTIES} properties`);
    }
    for (const [key, child] of entries) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error(`${path}.properties: forbidden property name "${key}"`);
      }
      assertSafeJsonSchema(child, `${path}.properties.${key}`, depth + 1);
    }
  }

  if (obj.required !== undefined) {
    if (!Array.isArray(obj.required) || obj.required.some((r) => typeof r !== 'string')) {
      throw new Error(`${path}.required: must be an array of strings`);
    }
  }

  if (obj.items !== undefined) {
    assertSafeJsonSchema(obj.items, `${path}.items`, depth + 1);
  }

  if (obj.prefixItems !== undefined) {
    if (!Array.isArray(obj.prefixItems)) {
      throw new Error(`${path}.prefixItems: must be an array`);
    }
    obj.prefixItems.forEach((child, i) =>
      assertSafeJsonSchema(child, `${path}.prefixItems[${i}]`, depth + 1),
    );
  }

  if (obj.additionalProperties !== undefined && typeof obj.additionalProperties !== 'boolean') {
    assertSafeJsonSchema(obj.additionalProperties, `${path}.additionalProperties`, depth + 1);
  }

  for (const comb of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (obj[comb] !== undefined) {
      if (!Array.isArray(obj[comb]) || (obj[comb] as unknown[]).length === 0) {
        throw new Error(`${path}.${comb}: must be a non-empty array`);
      }
      (obj[comb] as unknown[]).forEach((branch, i) =>
        assertSafeJsonSchema(branch, `${path}.${comb}[${i}]`, depth + 1),
      );
    }
  }
}

/** Check whether a manifest entry is a preset reference rather than inline schema. */
export function isPresetRef(spec: PluginDataSchemaSpec): spec is { preset: string; overrides?: Record<string, unknown> } {
  return typeof spec === 'object' && spec !== null && 'preset' in spec && typeof spec.preset === 'string';
}

/**
 * Validate a single `PluginDataSchemaSpec` (preset ref or inline schema) from a
 * plugin manifest. Throws descriptive errors on malformed or unsafe entries.
 */
export function validateDataSchemaSpec(spec: unknown, path = 'dataSchema'): void {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new Error(`${path}: must be an object`);
  }
  const obj = spec as Record<string, unknown>;

  if (typeof obj.preset === 'string') {
    if (!/^[a-z0-9:._/-]{1,80}$/i.test(obj.preset)) {
      throw new Error(`${path}.preset: invalid preset id "${obj.preset}"`);
    }
    if (obj.overrides !== undefined) {
      if (typeof obj.overrides !== 'object' || obj.overrides === null || Array.isArray(obj.overrides)) {
        throw new Error(`${path}.overrides: must be an object`);
      }
      const ov = obj.overrides as Record<string, unknown>;
      if (ov.rowSchema !== undefined) assertSafeJsonSchema(ov.rowSchema, `${path}.overrides.rowSchema`);
      if (ov.schema !== undefined) assertSafeJsonSchema(ov.schema, `${path}.overrides.schema`);
    }
    return;
  }

  const schema = obj as Partial<PluginDataSchema>;
  if (typeof schema.id !== 'string' || schema.id.trim().length === 0) {
    throw new Error(`${path}.id: must be a non-empty string`);
  }
  if (typeof schema.title !== 'string' || schema.title.trim().length === 0) {
    throw new Error(`${path}.title: must be a non-empty string`);
  }
  if (typeof schema.kind !== 'string' || !ALLOWED_KINDS.has(schema.kind)) {
    throw new Error(`${path}.kind: must be one of tabular | json | text | binary`);
  }
  if (!Array.isArray(schema.extensions) || schema.extensions.length === 0) {
    throw new Error(`${path}.extensions: must be a non-empty array of extensions`);
  }
  for (const ext of schema.extensions) {
    if (typeof ext !== 'string' || !ext.startsWith('.')) {
      throw new Error(`${path}.extensions: each entry must start with "." (got "${String(ext)}")`);
    }
  }

  if (schema.kind === 'tabular') {
    assertSafeJsonSchema(schema.rowSchema, `${path}.rowSchema`);
    if (schema.rowSchema.type !== 'object' || !schema.rowSchema.properties) {
      throw new Error(`${path}.rowSchema: tabular rowSchema must have type "object" with "properties"`);
    }
    if (!Array.isArray(schema.sampleRows)) {
      throw new Error(`${path}.sampleRows: must be an array`);
    }
  } else if (schema.kind === 'json') {
    assertSafeJsonSchema(schema.schema, `${path}.schema`);
  } else if (schema.kind === 'text') {
    if (schema.schema !== undefined) {
      assertSafeJsonSchema(schema.schema, `${path}.schema`);
    }
    if (typeof schema.sampleText !== 'string') {
      throw new Error(`${path}.sampleText: must be a string`);
    }
  } else if (schema.kind === 'binary') {
    if (!Array.isArray(schema.mimeTypes)) {
      throw new Error(`${path}.mimeTypes: must be an array`);
    }
  }
}

/** Validate `PluginManifest.dataSchema` (single spec or array of specs). */
export function validateManifestDataSchema(dataSchema: unknown): void {
  if (dataSchema === undefined) return;
  if (Array.isArray(dataSchema)) {
    if (dataSchema.length === 0) {
      throw new Error('cspkg: dataSchema array must not be empty');
    }
    dataSchema.forEach((item, i) => validateDataSchemaSpec(item, `cspkg: dataSchema[${i}]`));
    return;
  }
  validateDataSchemaSpec(dataSchema, 'cspkg: dataSchema');
}
