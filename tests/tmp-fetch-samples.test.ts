// TEMPORARY downloader — fetches candidate COD entries, validates them with
// the project's own CIF parser, and saves verified files into examples/data/.
import { describe, it } from 'vitest';
import { writeFileSync, existsSync } from 'node:fs';
import { parseCif } from '@/chem/parse/cif';
import { cellObservables } from '@/plugins/builtin/chem-crystal/cellInfo';

const CANDIDATES: Array<{ id: string; expectFormula: string; expectSites: number; codIds: number[] }> = [
  { id: 'diamond', expectFormula: 'C', expectSites: 8, codIds: [9008873, 1011097, 9012064] },
  { id: 'graphite', expectFormula: 'C', expectSites: 4, codIds: [9008938, 1011017, 1011036, 2011537] },
  { id: 'zincblende', expectFormula: 'ZnS', expectSites: 8, codIds: [9008875, 1010602, 1006740] },
  { id: 'copper', expectFormula: 'Cu', expectSites: 4, codIds: [9008464, 1011112, 1008754] },
  { id: 'dryice', expectFormula: 'CO2', expectSites: 12, codIds: [1011103, 1008782, 2231866] },
  { id: 'perovskite', expectFormula: 'SrTiO3', expectSites: 5, codIds: [9006871, 2101116, 1532434] },
];

describe('tmp COD fetch', () => {
  it('downloads and validates new samples', async () => {
    for (const cand of CANDIDATES) {
      const dest = `examples/data/chem-${cand.id}.cif`;
      if (existsSync(dest)) { console.log(`[fetch] ${cand.id}: already saved, skip`); continue; }
      let saved = false;
      for (const cod of cand.codIds) {
        if (saved) break;
        try {
          const res = await fetch(`https://www.crystallography.net/cod/${cod}.cif`, {
            headers: { 'User-Agent': 'ErgalicsStudio-sample-fetch/1.0 (CC0 COD data)' },
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) { console.log(`[fetch] ${cand.id} COD ${cod}: HTTP ${res.status}`); continue; }
          const text = await res.text();
          if (!text.includes('data_')) { console.log(`[fetch] ${cand.id} COD ${cod}: not a CIF`); continue; }
          let parsed;
          try { parsed = parseCif(text); } catch (e) { console.log(`[fetch] ${cand.id} COD ${cod}: parse error ${(e as Error).message}`); continue; }
          const info = cellObservables(parsed.params, parsed.sites);
          const formula = info.formula;
          const ok = formula === cand.expectFormula && parsed.sites.length === cand.expectSites;
          console.log(`[fetch] ${cand.id} COD ${cod}: formula=${formula} sites=${parsed.sites.length} a=${parsed.params.a.toFixed(2)} sg=${parsed.spaceGroup ?? '?'} → ${ok ? 'MATCH ✓' : 'mismatch'}`);
          if (ok) {
            writeFileSync(dest, text, 'utf8');
            console.log(`[fetch] ${cand.id}: SAVED COD ${cod} → ${dest}`);
            saved = true;
          }
        } catch (e) { console.log(`[fetch] ${cand.id} COD ${cod}: ${(e as Error).message}`); }
      }
      if (!saved) console.log(`[fetch] ${cand.id}: NO MATCH — needs manual pick`);
    }
  }, 240000);
});
