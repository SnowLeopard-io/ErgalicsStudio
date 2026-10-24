// ==========================================================================
// Ergalics Studio — IR → Python codegen (public surface)
// ==========================================================================

import type { IRProgram } from '../ir/types';
import { generate } from './core';

export function codegenPython(program: IRProgram): string {
  return generate(program, 'python');
}
