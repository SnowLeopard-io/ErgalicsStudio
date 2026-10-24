// ==========================================================================
// Ergalics Studio — IR → JavaScript codegen (public surface)
// ==========================================================================

import type { IRProgram } from '../ir/types';
import { generate } from './core';

export function codegenJS(program: IRProgram): string {
  return generate(program, 'js');
}
