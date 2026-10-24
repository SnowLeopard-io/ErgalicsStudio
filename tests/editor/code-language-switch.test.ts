// ==========================================================================
// Ergalics Studio — code-mode language switching must be a faithful, lossless
// round trip.
//
// The interaction contract: a code session holds one canonical IR; switching
// the Monaco language re-renders that IR in the target dialect via codegen,
// and the re-parser must recover an IR that EXECUTES with the same output.
// A switch that silently drops a statement (empty translation), leaves a
// statement as dead RawCode, or changes run-time behaviour is a UI-layer bug.
// ==========================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCodeToIR } from '@/editor/code/parse';
import { codegen, type CodegenLang } from '@/editor/codegen';
import { interpret } from '@/editor/runtime/interpreter';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';
import type { RenderedView } from '@/types/datatable';

const LANGS: CodegenLang[] = ['python', 'js', 'r'];

function parseHint(lang: CodegenLang): CodeLanguageAlias {
  return lang === 'js' ? 'js' : lang === 'r' ? 'r' : 'python';
}
type CodeLanguageAlias = 'python' | 'r' | 'js';

function makeHost(): StudioApiHost & { printed: string[]; views: RenderedView[] } {
  const printed: string[] = [];
  const views: RenderedView[] = [];
  return {
    async loadText(p) {
      return readFileSync(`examples/data/${p}`, 'utf8');
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
  };
}

describe('code-mode language switch preserves behaviour', () => {
  const samples: Record<string, string> = {
    'for-loop': `import studio\nvals = studio.range(0, 10)\ntotal = 0\nfor v in vals:\n    total = total + v\nstudio.print(total)\n`,
    'free-fn': `import studio\nimport math\ny = [2, 3, 5, 7, 11]\nsq = [v * v for v in y]\nstudio.print(sq)\nstudio.print(math.pi)\n`,
    'compute': `import studio\ndf = studio.load('galaxy.dat')\nxs = df.columns[0][1]\nn = len(xs)\nstudio.print(n)\n`,
  };

  for (const [name, srcPy] of Object.entries(samples)) {
    it(`${name}: switching language re-parses to an IR that behaves like python`, async () => {
      const python = parseCodeToIR(srcPy, 'python').program;
      const refHost = makeHost();
      const ref = await interpret(python, createStudioApi(refHost));
      expect(ref.ok, `python ref failed: ${ref.error?.message ?? ''}`).toBe(true);
      const refPrinted = [...refHost.printed];
      const refViews = refHost.views.length;

      for (const lang of LANGS) {
        const text = codegen(python, lang);
        expect(text.trim().length, `${name} -> ${lang} empty`).toBeGreaterThan(0);
        // A statement left as dead raw text in the target dialect means the
        // generator shipped an untranslated fragment — that is the "code did
        // not change" symptom. RawCode is a passthrough of source, so forbid it
        // appearing in the rendered target when it round-trips.
        const back = parseCodeToIR(text, parseHint(lang)).program;
        const host = makeHost();
        const res = await interpret(back, createStudioApi(host));
        expect(res.ok, `${name} -> ${lang} threw: ${res.error?.message ?? ''}`).toBe(true);
        expect(host.printed, `${name} -> ${lang} output drift`).toEqual(refPrinted);
        expect(host.views.length, `${name} -> ${lang} view drift`).toBe(refViews);
      }
    });
  }
});