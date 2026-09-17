// ==========================================================================
// Validation framework — public surface
// ==========================================================================

export { IssueBag, toResult, formatPath } from './types';
export type { IssueSeverity, ValidationIssue, ValidationResult } from './types';

export {
  validate,
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
  v,
} from './validators';
export type {
  Validator,
  StringOptions,
  NumberOptions,
  ArrayOptions,
  ObjectSchemaOptions,
  CustomCheck,
} from './validators';

export {
  parseJsonText,
  parseJsonObject,
  parseNumericText,
  locateTextOffset,
} from './parse';
export type { JsonLocation, NumericTextOptions, NumericTextResult } from './parse';
