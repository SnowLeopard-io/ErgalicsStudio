import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parseCodeToIR } from '@/editor/code/parse';
import { codegen } from '@/editor/codegen';

function lines(src: string): string[] {
  return src.replace(/\r/g, '').split('\n');
}

describe('xx', () => {
  it('dump R target and R->python switch', () => {
    for (const f of readdirSync('examples/code').filter((x) => x.endsWith('.py')).sort()) {
      const src = readFileSync(`examples/code/${f}`, 'utf8');
      const pyIR = parseCodeToIR(src, 'python').program;
      const rText = codegen(pyIR, 'r');
      const pyBack = codegen(parseCodeToIR(rText, 'r').program, 'python');
      // Only print ones where a top-level line references `x` while `xs` exists.
      const hasXs = /(^|\s|,|\()xs($|\s|,|\))/.test(pyBack);
      const usesBareX = /\bx\b/.test(pyBack);
      if (hasXs && usesBareX) {
        console.log('===== ' + f + ' =====');
        console.log('--- R ---\n' + lines(rText).join('\n'));
        console.log('--- py back ---');
        lines(pyBack).forEach((l, i) => console.log(String(i + 1).padStart(3) + '| ' + l));
      }
    }
    expect(true).toBe(true);
  });
});