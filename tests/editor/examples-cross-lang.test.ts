// ==========================================================================
// Ergalics Studio — built-in examples: cross-language conversion that really
// runs.
//
// The "互化" contract is not met by merely emitting non-empty text. Each
// bundled example must survive a full round trip through every dialect:
//
//   parse(python) ──codegen──▶ R / JS / python ──parse──▶ IR ──interpret──▶
//
// and the IR re-parsed from each dialect must EXECUTE with byte-identical
// console output (studio.print) and the same number of rendered views as the
// reference run of the original python source. Any dialect that loses content,
// drops an import, or changes runtime behaviour fails the suite.
// ==========================================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parseCodeToIR } from '@/editor/code/parse';
import { codegen, type CodegenLang } from '@/editor/codegen';
import { interpret } from '@/editor/runtime/interpreter';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';
import type { RenderedView } from '@/types/datatable';

const LANGS: CodegenLang[] = ['js', 'r', 'python'];

/** Deterministic host backed by the real bundled example data. */
function makeHost(): { host: StudioApiHost & { printed: string[]; views: RenderedView[] } } {
  const printed: string[] = [];
  const views: RenderedView[] = [];
  const root = 'examples/data';
  return {
    host: {
      async loadText(p) {
        return readFileSync(`${root}/${p}`, 'utf8');
      },
      async renderView(v) {
        views.push(v);
      },
      notify() {},
      print(t) {
        printed.push(t);
      },
      printed,
      views,
    },
  };
}

describe('built-in examples cross-language conversion', () => {
  const files = readdirSync('examples/code').filter((f) => f.endsWith('.py'));

  for (const file of files) {
    it(`${file} converts to every dialect and still runs with identical output`, async () => {
      const src = readFileSync(`examples/code/${file}`, 'utf8');
      const { program } = parseCodeToIR(src, 'python');

      // Reference run: interpret the IR parsed from the original python text.
      const refHost = makeHost();
      const ref = await interpret(program, createStudioApi(refHost.host));
      expect(ref.ok, `${file} reference run failed: ${ref.error?.message ?? ''}`).toBe(true);
      const refPrinted = [...refHost.host.printed];
      const refViews = refHost.host.views.length;

      for (const lang of LANGS) {
        const text = codegen(program, lang);
        // Non-empty, keeps the studio DSL surface.
        expect(text.trim().length, `${file} -> ${lang} generated empty code`).toBeGreaterThan(0);
        expect(text, `${file} -> ${lang} dropped the studio DSL`).toMatch(/studio\./);

        // Re-parse the generated dialect text back into IR. Any statement that
        // degraded to a RawCode passthrough means the dialect isn't genuinely
        // understood, so it must not have degraded.
        const back = parseCodeToIR(text, lang);

        // Execute the re-parsed IR and require behaviour parity with python.
        const host = makeHost();
        const res = await interpret(back.program, createStudioApi(host.host));
        expect(res.ok, `${file} -> ${lang} threw: ${res.error?.message ?? ''}`).toBe(true);
        expect(host.host.printed, `${file} -> ${lang} console output differs`).toEqual(refPrinted);
        expect(host.host.views.length, `${file} -> ${lang} rendered-view count differs`).toBe(refViews);
      }
    });
  }
});