// ==========================================================================
// Runtime assertions / boundary guards
//
// TypeScript only checks compile-time types; data crossing module, file,
// worker and network boundaries is `unknown` at runtime. These guards throw
// typed {@link ValidationError}s with field paths, so a failed boundary check
// surfaces a precise diagnostic instead of a downstream `undefined is not a
// function`. Prefer the validation framework for batch/user-input checks;
// these guards are for invariant-style programming in internal pipelines.
// ==========================================================================

import { ValidationError } from './AppError';

function fail(path: (string | number)[], code: string, message: string): never {
  throw ValidationError.fromMessage(path, code, message);
}

/** Classic assertion, throws a ValidationError with code `invariant`. */
export function invariant(
  condition: unknown,
  message: string,
  path: (string | number)[] = [],
): asserts condition {
  if (!condition) fail(path, 'invariant', message);
}

/** Assert value is neither null nor undefined and return it narrowed. */
export function assertDefined<T>(
  value: T | null | undefined,
  name = 'value',
  path: (string | number)[] = [name],
): T {
  if (value === null || value === undefined) {
    fail(path, 'required', `${name} is required`);
  }
  return value;
}

/** Assert value is a finite number (rejects NaN and ±Infinity). */
export function assertFiniteNumber(
  value: unknown,
  name = 'value',
  path: (string | number)[] = [name],
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'number.finite', `${name} must be a finite number`);
  }
}

/** Assert value is a safe integer within the optional [min, max] range. */
export function assertInteger(
  value: unknown,
  name = 'value',
  bounds: { min?: number; max?: number } = {},
  path: (string | number)[] = [name],
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(path, 'number.integer', `${name} must be an integer`);
  }
  if (bounds.min !== undefined && value < bounds.min) {
    fail(path, 'number.min', `${name} must be >= ${bounds.min}`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    fail(path, 'number.max', `${name} must be <= ${bounds.max}`);
  }
}

/** Assert a finite number lies within an inclusive range. */
export function assertRange(
  value: unknown,
  min: number,
  max: number,
  name = 'value',
  path: (string | number)[] = [name],
): asserts value is number {
  assertFiniteNumber(value, name, path);
  if (value < min || value > max) {
    fail(path, 'number.range', `${name} must be within [${min}, ${max}]`);
  }
}

/** Assert value is a non-empty trimmed string; returns the trimmed value. */
export function assertNonEmptyString(
  value: unknown,
  name = 'value',
  path: (string | number)[] = [name],
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(path, 'string.nonempty', `${name} must be a non-empty string`);
  }
  return value.trim();
}

/** Assert value is an array (optionally bounded in length). */
export function assertArray<T>(
  value: unknown,
  name = 'value',
  bounds: { min?: number; max?: number } = {},
  path: (string | number)[] = [name],
): asserts value is T[] {
  if (!Array.isArray(value)) fail(path, 'array', `${name} must be an array`);
  if (bounds.min !== undefined && value.length < bounds.min) {
    fail(path, 'array.min', `${name} must contain at least ${bounds.min} item(s)`);
  }
  if (bounds.max !== undefined && value.length > bounds.max) {
    fail(path, 'array.max', `${name} must contain at most ${bounds.max} item(s)`);
  }
}

/** Exhaustiveness helper for switch/if narrowing. */
export function assertNever(value: never, name = 'value'): never {
  fail([], 'unreachable', `Unreachable ${name}: ${String(value)}`);
}
