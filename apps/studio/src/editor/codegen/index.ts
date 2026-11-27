// ==========================================================================
// Ergalics Studio — codegen public surface
// ==========================================================================

import type { IRProgram } from '@/editor/ir/types';
import { generate, type CodegenLang } from './core';

export { generate } from './core';
export type { CodegenLang } from './core';
export { codegenJS } from './js';
export { codegenPython } from './python';
export { codegenR } from './r';

/** 統一入口：將 IR 程式渲染為指定的目標方言。 */
export function codegen(program: IRProgram, lang: CodegenLang = 'python'): string {
  return generate(program, lang);
}
