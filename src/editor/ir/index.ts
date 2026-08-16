// ==========================================================================
// Ergalics Studio — IR public surface
//
// Everything the rest of the app imports from the IR module lives here, so
// consumers never reach into `ir/*` internals directly.
// ==========================================================================

export {
  IR_VERSION,
  isRawCode,
  isFuncDef,
  makeProgram,
} from './types';
export type {
  BinaryOperator,
  UnaryOperator,
  NormalizeMode,
  SourceLang,
  IRNode,
  IRProgram,
  IRDiagnostic,
} from './types';
export { hashString, hashIR, stableStringify } from './hash';
export { validateIR } from './validate';
export { serializeIR, deserializeIR } from './serialize';
