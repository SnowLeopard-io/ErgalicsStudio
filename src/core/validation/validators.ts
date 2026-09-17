// ==========================================================================
// Composable validators
//
// A validator is a pure function `(value, path) => issues[]`. Composition is
// plain function composition, so schemas are ordinary data: they can be
// reused, partially applied, unit-tested without React, and shared between
// import boundaries and editor forms.
//
// Convention: type validators (`isString`, `isNumber`, …) *skip* null and
// undefined. Compose with `required()` when a value must be present — this
// mirrors optional/required column semantics in scientific schemas.
// ==========================================================================

import { IssueBag, toResult } from './types';
import type { Path, ValidationIssue, ValidationResult } from './types';

export type Validator<_T = unknown> = (value: unknown, path: Path) => ValidationIssue[];

/** Run a validator and collapse to a result (lazy: every issue collected). */
export function validate<T>(validator: Validator<T>, value: unknown): ValidationResult<T> {
  return toResult(validator(value, []), value as T);
}

function issue(
  path: Path,
  code: string,
  message: string,
  value?: unknown,
): ValidationIssue {
  return { path, code, message, severity: 'error', ...(value === undefined ? {} : { value }) };
}

// ---- presence --------------------------------------------------------------

export function required(message = 'This field is required'): Validator {
  return (value, path) => (value === undefined || value === null ? [issue(path, 'required', message, value)] : []);
}

// ---- primitives ------------------------------------------------------------

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  /** Reject blank/whitespace-only strings. */
  nonBlank?: boolean;
}

export function isString(options: StringOptions = {}): Validator<string> {
  return (value, path) => {
    if (value === undefined || value === null) return [];
    const issues: ValidationIssue[] = [];
    if (typeof value !== 'string') {
      issues.push(issue(path, 'type', `Expected a string, got ${typeName(value)}`, value));
      return issues;
    }
    if (options.nonBlank && value.trim().length === 0) {
      issues.push(issue(path, 'string.blank', 'String must not be blank', value));
    }
    if (options.minLength !== undefined && value.length < options.minLength) {
      issues.push(issue(path, 'string.minLength', `Must be at least ${options.minLength} character(s)`, value));
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      issues.push(issue(path, 'string.maxLength', `Must be at most ${options.maxLength} character(s)`, value));
    }
    if (options.pattern && !options.pattern.test(value)) {
      issues.push(issue(path, 'string.pattern', options.patternMessage ?? 'Invalid format', value));
    }
    return issues;
  };
}

export interface NumberOptions {
  /** Reject NaN and ±Infinity (default true). */
  finite?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  /** Exclude the min/max bounds themselves. */
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
}

export function isNumber(options: NumberOptions = {}): Validator<number> {
  return (value, path) => {
    if (value === undefined || value === null) return [];
    const issues: ValidationIssue[] = [];
    if (typeof value !== 'number') {
      issues.push(issue(path, 'type', `Expected a number, got ${typeName(value)}`, value));
      return issues;
    }
    const finite = options.finite ?? true;
    if (Number.isNaN(value)) {
      if (finite) issues.push(issue(path, 'number.nan', 'Must not be NaN', value));
    } else if (!Number.isFinite(value)) {
      if (finite) issues.push(issue(path, 'number.infinite', 'Must be a finite number', value));
    } else {
      if (options.integer && !Number.isInteger(value)) {
        issues.push(issue(path, 'number.integer', 'Must be an integer', value));
      }
      if (options.min !== undefined) {
        const violated = options.exclusiveMin ? value <= options.min : value < options.min;
        if (violated) {
          issues.push(issue(
            path,
            options.exclusiveMin ? 'number.exclusiveMin' : 'number.min',
            options.exclusiveMin ? `Must be > ${options.min}` : `Must be >= ${options.min}`,
            value,
          ));
        }
      }
      if (options.max !== undefined) {
        const violated = options.exclusiveMax ? value >= options.max : value > options.max;
        if (violated) {
          issues.push(issue(
            path,
            options.exclusiveMax ? 'number.exclusiveMax' : 'number.max',
            options.exclusiveMax ? `Must be < ${options.max}` : `Must be <= ${options.max}`,
            value,
          ));
        }
      }
    }
    return issues;
  };
}

export function isBoolean(): Validator<boolean> {
  return (value, path) => {
    if (value === undefined || value === null) return [];
    return typeof value === 'boolean'
      ? []
      : [issue(path, 'type', `Expected a boolean, got ${typeName(value)}`, value)];
  };
}

export function literal<T extends string | number | boolean | null>(expected: T): Validator<T> {
  return (value, path) =>
    value === expected ? [] : [issue(path, 'literal', `Expected ${String(expected)}`, value)];
}

export function oneOf<T>(allowed: ReadonlyArray<T>, message?: string): Validator<T> {
  return (value, path) => {
    if (value === undefined || value === null) return [];
    return allowed.includes(value as T)
      ? []
      : [issue(path, 'oneOf', message ?? `Must be one of: ${allowed.map(String).join(', ')}`, value)];
  };
}

// ---- containers ------------------------------------------------------------

export interface ArrayOptions {
  minLength?: number;
  maxLength?: number;
}

export function arrayOf<T>(item: Validator<T>, options: ArrayOptions = {}): Validator<T[]> {
  return (value, path) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      return [issue(path, 'type', `Expected an array, got ${typeName(value)}`, value)];
    }
    const bag = new IssueBag();
    if (options.minLength !== undefined && value.length < options.minLength) {
      bag.addAt(path, 'array.minLength', `Must contain at least ${options.minLength} item(s)`, 'error', value);
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      bag.addAt(path, 'array.maxLength', `Must contain at most ${options.maxLength} item(s)`, 'error', value);
    }
    value.forEach((entry, index) => {
      const itemPath = [...path, index];
      for (const itemIssue of item(entry, itemPath)) bag.add(itemIssue);
    });
    return bag.issues;
  };
}

export interface ObjectSchemaOptions {
  /** Report unknown keys as errors (default false — unknown keys are allowed). */
  strict?: boolean;
}

/**
 * Validate a plain object against per-key validators. Key paths become
 * `….<key>`. In strict mode unknown keys raise `object.unknown`.
 */
export function objectSchema<T extends Record<string, unknown>>(
  fields: { [K in keyof T]: Validator<T[K]> },
  options: ObjectSchemaOptions = {},
): Validator<T> {
  return (value, path) => {
    if (value === undefined || value === null) return [];
    if (typeof value !== 'object' || Array.isArray(value)) {
      return [issue(path, 'type', `Expected an object, got ${typeName(value)}`, value)];
    }
    const bag = new IssueBag();
    const record = value as Record<string, unknown>;
    for (const [key, validator] of Object.entries(fields)) {
      const fieldPath = [...path, key];
      // Validators already return issues rooted at the passed field path, so
      // add them directly (merging again would duplicate the prefix).
      for (const fieldIssue of validator(record[key], fieldPath)) bag.add(fieldIssue);
    }
    if (options.strict) {
      const known = new Set(Object.keys(fields));
      for (const key of Object.keys(record)) {
        if (!known.has(key)) {
          bag.addAt([...path, key], 'object.unknown', `Unknown key "${key}"`, 'error', record[key]);
        }
      }
    }
    return bag.issues;
  };
}

// ---- composition -----------------------------------------------------------

/** Run every validator and concatenate issues (logical AND, always lazy). */
export function chain<T>(...validators: Array<Validator<T>>): Validator<T> {
  return (value, path) =>
    validators.flatMap((validator) => validator(value, path));
}

/** Skip the inner validator when the value is null/undefined. */
export function optional<T>(validator: Validator<T>): Validator<T | undefined> {
  return (value, path) => (value === undefined || value === null ? [] : validator(value, path));
}

/** Accept the first branch with no errors; otherwise report the branch whose
 *  issues are fewest (union discriminator, e.g. grid|list|lhs configs). */
export function union<T>(...branches: Array<Validator<T>>): Validator<T> {
  return (value, path) => {
    let best: ValidationIssue[] | null = null;
    for (const branch of branches) {
      const issues = branch(value, path);
      if (issues.length === 0) return [];
      if (!best || issues.length < best.length) best = issues;
    }
    return best ?? [];
  };
}

export type CustomCheck<T> = (
  value: T,
  path: Path,
) => ValidationIssue | ValidationIssue[] | undefined | null | void;

/** Lift a hand-written check into a Validator. */
export function custom<T>(check: CustomCheck<T>): Validator<T> {
  return (value, path) => {
    const result = check(value as T, path);
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  };
}

/** Validator namespace for call sites that prefer `v.isNumber(...)`. */
export const v = {
  required,
  isString,
  isNumber,
  isBoolean,
  literal,
  oneOf,
  arrayOf,
  objectSchema,
  chain,
  optional,
  union,
  custom,
};

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
