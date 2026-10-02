// Plugin-starter contract test (EG4-96).
//
// The host executes the BUILT template entry as a function body:
// `new Function('api', source)`. A top-level `let api` in the entry shares
// the parameter's name in an inner lexical scope, which is a SyntaxError
// ("Identifier 'api' has already been declared") — the starter plugin then
// fails to boot on both the isolated and legacy sandbox paths. The entry
// must bind `var api`, which shares the parameter binding without conflict.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const entrySrc = readFileSync(
  new URL('../../templates/plugin-starter/src/index.ts', import.meta.url),
  'utf-8',
);

describe('plugin-starter entry contract', () => {
  it('binds api with var so new Function("api", source) can compile (EG4-96)', () => {
    expect(entrySrc).toMatch(/^var api: PluginApi;/m);
  });

  it('never declares api with let/const (SyntaxError against the host parameter)', () => {
    expect(entrySrc).not.toMatch(/^\s*(let|const) api\b/m);
  });

  it('contains no import/export statements (script-mode build contract)', () => {
    // Strip comments first — the header documentation mentions the rule.
    const code = entrySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/^\s*(import|export)\b/m);
  });
});
