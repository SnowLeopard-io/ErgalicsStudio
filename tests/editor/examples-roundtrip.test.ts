// Regression: every examples/code/*.py must convert losslessly across the
// py↔r↔js matrix. All six directed edges per example must produce code with
// zero RawCode fallbacks, and re-parsing the r→py / js→py products must
// reproduce the original python IR exactly (a fixed point), so a program
// keeps the same block-mode representation in every language.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCodeToIR } from '@/editor/code/parse';
import { codegen } from '@/editor/codegen';

const dir = join(process.cwd(), 'examples/code');
const files = readdirSync(dir).filter((f) => f.endsWith('.py'));

type Lang = 'python' | 'r' | 'js';

function convert(code: string, lang: Lang, target: Lang): { out: string; rawCount: number; crash: string } {
  const { program, rawCount } = parseCodeToIR(code, lang);
  let out = '';
  let crash = '';
  try {
    out = codegen(program, target);
  } catch (err) {
    crash = err instanceof Error ? err.message : String(err);
  }
  return { out, rawCount, crash };
}

function firstRawText(code: string, lang: Lang): string {
  const raws: string[] = [];
  const walk = (nodes: unknown): void => {
    for (const n of Array.isArray(nodes) ? nodes : []) {
      const node = n as { kind?: string; text?: string; body?: unknown; branches?: { body?: unknown }[]; elseBody?: unknown };
      if (node.kind === 'RawCode' && node.text) raws.push(node.text);
      if (node.body) walk(node.body);
      if (node.branches) for (const b of node.branches) walk(b.body);
      if (node.elseBody) walk(node.elseBody);
    }
  };
  walk(parseCodeToIR(code, lang).program.body);
  return raws[0]?.split('\n').join(' ⏎ ').slice(0, 160) ?? '';
}

// Imports are dropped when rendering R/JS — an accepted, semantically-neutral
// difference — so they are excluded from the fixed-point comparison.
const stripImports = (nodes: unknown): string =>
  JSON.stringify((nodes as { kind: string }[]).filter((n) => n.kind !== 'Import'));

describe('examples cross-language round-trip', () => {
  for (const f of files) {
    it(f, () => {
      const py = readFileSync(join(dir, f), 'utf8');
      const results = new Map<string, { out: string; rawCount: number; crash: string }>();
      for (const target of ['r', 'js'] as const) {
        results.set(`py→${target}`, convert(py, 'python', target));
      }
      for (const srcLang of ['r', 'js'] as const) {
        const gen = results.get(`py→${srcLang}`)!;
        for (const target of ['python', 'js', 'r'] as const) {
          if (target === srcLang) continue;
          results.set(`${srcLang}→${target}`, convert(gen.out, srcLang, target));
        }
      }

      for (const [edge, res] of results) {
        expect(res.crash, `${edge}: codegen crashed`).toBe('');
        expect(res.rawCount, `${edge}: first raw → ${firstRawText(res.out, edge.split('→')[1] as Lang)}`).toBe(0);
      }

      const baseIR = stripImports(parseCodeToIR(py, 'python').program.body);
      for (const srcLang of ['r', 'js'] as const) {
        const back = results.get(`${srcLang}→python`)!;
        if (back.crash) continue;
        const backIR = stripImports(parseCodeToIR(back.out, 'python').program.body);
        expect(backIR, `${srcLang}→py IR drifted from the original`).toBe(baseIR);
      }
    });
  }
});
