// ==========================================================================
// Validation framework — composable validators, lazy issue collection,
// safe JSON / numeric text parsing.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  validate,
  required,
  isString,
  isNumber,
  isBoolean,
  oneOf,
  arrayOf,
  objectSchema,
  chain,
  optional,
  union,
  custom,
  parseJsonText,
  parseJsonObject,
  parseNumericText,
  formatPath,
  toResult,
  IssueBag,
} from '@/core/validation';
import { DataError } from '@/core/errors';

describe('primitive validators', () => {
  it('required vs optional presence', () => {
    expect(validate(required(), undefined).valid).toBe(false);
    expect(validate(required(), null).valid).toBe(false);
    expect(validate(required(), 'x').valid).toBe(true);
    expect(validate(optional(isNumber()), undefined).valid).toBe(true);
    expect(validate(optional(isNumber()), 'x').valid).toBe(false);
  });

  it('numbers enforce finiteness, integrality and bounds', () => {
    expect(validate(isNumber(), 3).valid).toBe(true);
    expect(validate(isNumber(), Number.NaN).errors[0]?.code).toBe('number.nan');
    expect(validate(isNumber(), Number.POSITIVE_INFINITY).errors[0]?.code).toBe('number.infinite');
    expect(validate(isNumber(), '1').errors[0]?.code).toBe('type');

    expect(validate(isNumber({ integer: true }), 1.5).errors[0]?.code).toBe('number.integer');
    expect(validate(isNumber({ min: 0, max: 10 }), -1).errors[0]?.code).toBe('number.min');
    expect(validate(isNumber({ min: 0, max: 10 }), 11).errors[0]?.code).toBe('number.max');
    expect(validate(isNumber({ finite: false }), Number.POSITIVE_INFINITY).valid).toBe(true);
  });

  it('strings enforce blank/length/pattern', () => {
    expect(validate(isString({ nonBlank: true }), '   ').valid).toBe(false);
    expect(validate(isString({ minLength: 2 }), 'a').errors[0]?.code).toBe('string.minLength');
    expect(validate(isString({ maxLength: 3 }), 'abcd').errors[0]?.code).toBe('string.maxLength');
    expect(
      validate(isString({ pattern: /^v\d+$/, patternMessage: 'bad' }), 'vx').errors[0]?.message,
    ).toBe('bad');
  });

  it('booleans and oneOf', () => {
    expect(validate(isBoolean(), true).valid).toBe(true);
    expect(validate(isBoolean(), 'true').valid).toBe(false);
    expect(validate(oneOf(['a', 'b']), 'c').valid).toBe(false);
    expect(validate(oneOf(['a', 'b']), 'a').valid).toBe(true);
  });

  it('chain collects issues lazily from every validator', () => {
    const result = validate(chain(required(), isNumber({ min: 10 })), 5);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('number.min');
  });
});

describe('containers and composition', () => {
  it('validates array items with index paths', () => {
    const result = validate(arrayOf(isNumber({ integer: true }), { minLength: 2 }), [1, 'x', 2.5]);
    expect(result.valid).toBe(false);
    expect(result.issueAt([1])?.code).toBe('type');
    expect(result.issueAt([2])?.code).toBe('number.integer');

    expect(validate(arrayOf(isNumber(), { minLength: 1 }), []).errors[0]?.code).toBe(
      'array.minLength',
    );
    expect(validate(arrayOf(isNumber()), 'nope').errors[0]?.code).toBe('type');
  });

  it('validates nested objects and strict unknown keys', () => {
    const schema = objectSchema({
      name: chain(required(), isString()),
      config: objectSchema({ flag: optional(isBoolean()) }),
    });
    const result = validate(schema, { name: 12, config: { flag: 'yes' }, extra: 1 });
    expect(result.valid).toBe(false);
    expect(result.issueAt(['name'])?.code).toBe('type');
    expect(result.issueAt(['config', 'flag'])?.code).toBe('type');
    // Non-strict: unknown key tolerated.
    expect(result.issueAt(['extra'])).toBeUndefined();

    const strict = validate(
      objectSchema({ name: isString() }, { strict: true }),
      { name: 'ok', rogue: 1 },
    );
    expect(strict.issueAt(['rogue'])?.code).toBe('object.unknown');
  });

  it('union picks the branch with fewest issues; custom lifts hand checks', () => {
    const asInt = chain(isNumber(), isNumber({ integer: true }));
    const asText = isString();
    const result = validate(union(asInt, asText), 1.5);
    expect(result.valid).toBe(false);
    expect(validate(union(asInt, asText), 'hello').valid).toBe(true);

    const positiveEven = custom<number>((value) =>
      value > 0 && value % 2 === 0
        ? undefined
        : { path: [], code: 'custom', message: 'must be positive even' },
    );
    expect(validate(positiveEven, 3).errors[0]?.message).toBe('must be positive even');
    expect(validate(positiveEven, 4).valid).toBe(true);
  });
});

describe('IssueBag / result helpers', () => {
  it('merges nested issues under a prefix', () => {
    const bag = new IssueBag();
    bag.addAt(['name'], 'required', 'name required');
    bag.merge(['axes', 0], [{ path: ['steps'], code: 'x', message: 'bad steps' }]);
    const result = toResult(bag.issues);
    expect(result.valid).toBe(false);
    expect(result.issueAt(['axes', 0, 'steps'])?.code).toBe('x');
    expect(formatPath(['axes', 0, 'steps'])).toBe('axes[0].steps');
  });
});

describe('safe text parsing', () => {
  it('parses valid JSON and reports empty input', () => {
    const parsed = parseJsonText<{ a: number }>('{"a":1}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ a: 1 });

    const empty = parseJsonText('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('data.json_empty');
  });

  it('locates JSON syntax errors by line/column', () => {
    const bad = parseJsonText('{\n  "a": 1,\n}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBeInstanceOf(DataError);
      expect(bad.error.details.line).toBeGreaterThanOrEqual(1);
      expect(bad.error.details.column).toBeGreaterThanOrEqual(1);
      expect(bad.error.message).toMatch(/line \d+, column \d+/);
    }
  });

  it('requires JSON objects (not arrays or scalars)', () => {
    expect(parseJsonObject('[1,2]').ok).toBe(false);
    expect(parseJsonObject('"x"').ok).toBe(false);
    const good = parseJsonObject('{"k": 1}');
    expect(good.ok).toBe(true);
  });

  it('parses numeric text strictly', () => {
    expect(parseNumericText(' 3 ')).toEqual({ ok: true, value: 3 });
    expect(parseNumericText('1e3')).toEqual({ ok: true, value: 1000 });
    expect(parseNumericText('.5')).toEqual({ ok: true, value: 0.5 });

    expect(parseNumericText('').ok).toBe(false);
    expect(parseNumericText('   ').ok).toBe(false);
    expect(parseNumericText('abc').ok).toBe(false);
    expect(parseNumericText('0x10').ok).toBe(false);
    expect(parseNumericText('Infinity').ok).toBe(false);
    expect(parseNumericText('12px').ok).toBe(false);

    const intResult = parseNumericText('2.5', { integer: true });
    expect(intResult.ok).toBe(false);
    if (!intResult.ok) expect(intResult.code).toBe('number.integer');

    const minResult = parseNumericText('-1', { min: 0 });
    expect(minResult.ok).toBe(false);
    if (!minResult.ok) expect(minResult.code).toBe('number.min');
  });
});
