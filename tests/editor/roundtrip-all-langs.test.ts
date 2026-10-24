// ==========================================================================
// Ergalics Studio — built-in examples + sample snippets: free, loss-free
// switching across all three code-mode languages.
//
// "自由切换" is only actually safe if a round trip through ANY middle
// language leaves the program behaving identically, AND re-generating from the
// returning text does not keep reformatting (non-idempotent drift). Every code
// snippet is therefore tested from every start language (Python / R / JS)
// through every middle language, comparing runtime semantics and checking that
// the returning text is already in canonical form.
//
// It also guards the R target: code generated for R must be real R — no
// Python-ism may leak as dead text (which the interpreter can "pass through"
// but a real webR session would reject).
// ==========================================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parseCodeToIR } from '@/editor/code/parse';
import { codegen, type CodegenLang } from '@/editor/codegen';
import { interpret } from '@/editor/runtime/interpreter';
import { createStudioApi } from '@/editor/runtime/studio-api';
import { CODE_SAMPLES } from '@/editor/code/samples';

const LANGS: CodegenLang[] = ['python', 'js', 'r'];
const hint: Record<string, CodegenLang> = { python: 'python', js: 'js', r: 'r' };

/** Python-isms that would break a real R session if leaked as dead text. */
const R_PY_LEAK =
  /:[ \t]+for [a-z_]|\[[^\]]*[ \t]+for[ \t]|zip\(|^[\t ]*import [a-z_]+ as |\.append\(\)|\[:\]|^[\t ]*(True|False|None)[ \t]*$/m;

function makeHost() {
  const printed: unknown[] = [];
  const views: unknown[] = [];
  return {
    host: {
      async loadText(p: string) {
        return readFileSync(`examples/data/${p}`, 'utf8');
      },
      async renderView() {
        views.push(1);
      },
      notify() {},
      print(t: unknown) {
        printed.push(t);
      },
    },
    printed,
    views,
  };
}

async function run(text: string, lang: CodegenLang) {
  const h = makeHost();
  const res = await interpret(parseCodeToIR(text, lang).program, createStudioApi(h.host));
  return { ok: res.ok, printed: JSON.stringify(h.printed), views: h.views.length };
}

describe('cross-language round-trip (every start x every middle)', () => {
  const samples: [string, string][] = [
    ...CODE_SAMPLES.map((s) => [`sample:${s.id}`, s.python] as [string, string]),
    ...readdirSync('examples/code')
      .filter((f) => f.endsWith('.py'))
      .map((f) => [`file:${f}`, readFileSync(`examples/code/${f}`, 'utf8')] as [string, string]),
  ];

  for (const [id, py] of samples) {
    const pyIR = parseCodeToIR(py, 'python').program;
    const T = { python: codegen(pyIR, 'python'), js: codegen(pyIR, 'js'), r: codegen(pyIR, 'r') } as const;

    it(`R target of ${id} contains no python leak`, () => {
      expect(T.r, `leak in:\n${T.r}`).not.toMatch(R_PY_LEAK);
    });

    for (const from of LANGS) {
      for (const via of LANGS) {
        it(`${id}: ${from} -> ${via} -> ${from} keeps behaviour and settles`, async () => {
          const base = await run(T[from], from);
          const viaText = codegen(parseCodeToIR(T[from], from).program, via);
          const backText = codegen(parseCodeToIR(viaText, hint[via]).program, from);
          const back = await run(backText, from);
          expect(back, `${from}->${via}->${from} drifted:\n${viaText}\n→\n${backText}`).toEqual(base);
          expect(codegen(parseCodeToIR(backText, from).program, from)).toBe(backText);
        });
      }
    }
  }
});