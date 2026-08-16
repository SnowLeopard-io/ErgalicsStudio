// ==========================================================================
// Ergalics Studio — shared IR (intermediate representation) types
//
// The IR is the single source of truth shared by the Scratch-like Block mode
// and the Python/R Code mode. It is a JSON-serializable AST so it can be
// persisted, shipped across Worker boundaries and version-diffed. The design
// follows Microsoft MakeCode's blocks⇄text model: a restricted AST plus a
// `RawCode` fallback node for anything the IR cannot express.
//
// See block-code-modes.md §4 for the full node catalogue and design rationale.
// ==========================================================================

/** Binary operators expressible by blocks and (de)serializable to code. */
export type BinaryOperator =
  | '+' | '-' | '*' | '/' | '//' | '%' | '**'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';

/** Unary operators (logical `not` / arithmetic negation). */
export type UnaryOperator = '-' | 'not';

/** Normalization mode for the `Normalize` node. */
export type NormalizeMode = 'minmax' | 'zscore';

/** Source languages the RawCode node / IR program can originate from. */
export type SourceLang = 'python' | 'r' | 'js';

/**
 * IR node — a discriminated union over `kind`. Every node is plain JSON.
 * The union deliberately stays a *restricted* subset of the host languages:
 * anything outside it (list comprehensions, decorators, R pipes, …) must be
 * preserved inside a `RawCode` node instead of being silently re-interpreted.
 */
export type IRNode =
  // ---- literals ----
  | { kind: 'Number'; value: number }
  | { kind: 'String'; value: string }
  | { kind: 'Boolean'; value: boolean }
  | { kind: 'Null' }
  // ---- variables ----
  | { kind: 'VarRef'; name: string }
  | { kind: 'VarAssign'; name: string; value: IRNode; declare: boolean }
  // ---- collections ----
  | { kind: 'List'; items: IRNode[] }
  | { kind: 'ListIndex'; list: IRNode; index: IRNode }
  | { kind: 'ListSlice'; list: IRNode; start?: IRNode; stop?: IRNode; step?: IRNode }
  | { kind: 'Dict'; entries: { key: string; value: IRNode }[] }
  // ---- operators ----
  | { kind: 'BinaryOp'; op: BinaryOperator; left: IRNode; right: IRNode }
  | { kind: 'UnaryOp'; op: UnaryOperator; operand: IRNode }
  // ---- control flow ----
  | { kind: 'If'; branches: { cond: IRNode; body: IRNode[] }[]; elseBody?: IRNode[] }
  | { kind: 'Repeat'; count: IRNode; body: IRNode[] }
  | { kind: 'While'; cond: IRNode; body: IRNode[] }
  | { kind: 'ForEach'; varName: string; iterable: IRNode; body: IRNode[] }
  | { kind: 'Break' }
  | { kind: 'Continue' }
  // ---- functions ----
  | { kind: 'FuncDef'; name: string; params: string[]; body: IRNode[] }
  | { kind: 'Return'; value?: IRNode }
  | { kind: 'Call'; callee: string; args: IRNode[] }
  // ---- data sources ----
  | { kind: 'LoadCSV'; path: string }
  | { kind: 'LoadXYZ'; path: string }
  | { kind: 'Random'; count: IRNode; seed?: IRNode }
  | { kind: 'Range'; start: IRNode; stop: IRNode; step?: IRNode }
  // ---- transforms ----
  | { kind: 'Filter'; data: IRNode; column: string; op: BinaryOperator; value: IRNode }
  | { kind: 'Normalize'; data: IRNode; column: string; mode: NormalizeMode }
  | { kind: 'Sort'; data: IRNode; column: string; direction: 'asc' | 'desc' }
  | { kind: 'Select'; data: IRNode; columns: string[] }
  | { kind: 'AddColumn'; data: IRNode; name: string; values: IRNode }
  // ---- statistics ----
  | { kind: 'Summary'; data: IRNode; column: string }
  | { kind: 'Histogram'; data: IRNode; column: string; bins: IRNode }
  // ---- visualization ----
  | { kind: 'PlotScatter'; data: IRNode; x: string; y: string; color?: string }
  | { kind: 'PlotLine'; data: IRNode; x: string; y: string }
  | { kind: 'PlotHistogram'; data: IRNode; column: string }
  | { kind: 'PlotPointCloud'; data: IRNode; x: string; y: string; z: string }
  // ---- GPU / host ----
  | { kind: 'GpuRun'; kernel: string; args: IRNode[] }
  | { kind: 'StudioCall'; method: string; args: IRNode[] }
  // ---- fallback ----
  | { kind: 'RawCode'; lang: SourceLang; text: string };

/** IR schema version (bump on breaking shape changes). */
export const IR_VERSION = 1 as const;

/**
 * The serialized program. `body` holds top-level statements, `functions`
 * holds top-level `FuncDef`s. `hash` is a content fingerprint used by the
 * sync engine to tell "which side changed" without deep comparison.
 */
export interface IRProgram {
  version: typeof IR_VERSION;
  body: IRNode[];
  functions: IRNode[];
  sourceLang?: SourceLang;
  hash: string;
}

/** A validation issue, carrying the offending node's location path. */
export interface IRDiagnostic {
  /** JSON-pointer-ish path to the node, e.g. `body[2].branches[0].cond`. */
  path: string;
  message: string;
}

/**
 * Build a program and stamp its content hash. Pure and synchronous so the
 * sync engine can call it inline (the `hash` field is a dedup fingerprint,
 * not a cryptographic digest — see hash.ts).
 */
export function makeProgram(
  body: IRNode[],
  functions: IRNode[] = [],
  sourceLang?: SourceLang,
): IRProgram {
  return { version: IR_VERSION, body, functions, sourceLang, hash: '' };
}

/** Type guard: does this node preserve raw, unparseable source text? */
export function isRawCode(node: IRNode): node is Extract<IRNode, { kind: 'RawCode' }> {
  return node.kind === 'RawCode';
}

/** Type guard for a statement-level node that may appear in a body. */
export function isFuncDef(node: IRNode): node is Extract<IRNode, { kind: 'FuncDef' }> {
  return node.kind === 'FuncDef';
}
