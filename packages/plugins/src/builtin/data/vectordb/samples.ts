// ==========================================================================
// Embedded deterministic samples for the Vector Store plugin.
//
//  - VECTORDB_SAMPLE_JSON: {"documents":[...]} with 60 short English
//    sentences, 15 per theme, composed from four theme vocabulary pools
//    (astronomy / cooking / sports / music) with a seeded RNG, so the JSON
//    text is identical on every load and the plugin boots ready to Run.
//  - VECTORDB_SAMPLE_NUMERIC_CSV: 120 rows x 8 features drawn from 3 seeded
//    clusters (kernel generator) in `f0..f7` CSV form.
// ==========================================================================

import { generateSyntheticVectors, mulberry32 } from './kernel';

/** Theme vocabulary pools (15 words each); same-theme documents share words. */
const THEME_POOLS: Record<string, string[]> = {
  astronomy: [
    'telescope', 'orbit', 'galaxy', 'nebula', 'comet', 'eclipse', 'planet', 'asteroid',
    'observatory', 'satellite', 'meteor', 'gravity', 'constellation', 'cosmos', 'starlight',
  ],
  cooking: [
    'recipe', 'kitchen', 'oven', 'simmer', 'dough', 'spice', 'roast', 'broth',
    'grill', 'knead', 'marinate', 'sauce', 'bake', 'seasoning', 'skillet',
  ],
  sports: [
    'stadium', 'match', 'tournament', 'coach', 'sprint', 'marathon', 'league', 'goalkeeper',
    'training', 'referee', 'playoff', 'athlete', 'relay', 'championship', 'sideline',
  ],
  music: [
    'melody', 'chord', 'rhythm', 'concert', 'violin', 'tempo', 'harmony', 'orchestra',
    'album', 'guitar', 'chorus', 'sonata', 'percussion', 'composer', 'rehearsal',
  ],
};

/** Neutral five-slot sentence templates shared by all themes. */
const TEMPLATES: string[] = [
  'The {0} drifts past the {1} while a quiet {2} rests beside the {3} and the {4}.',
  'A careful study of the {0} begins with the {1}, pauses at the {2} and ends at the {3} near the {4}.',
  'Notes from the field: the {0} and the {1} were recorded while the {2} answered the {3} under the {4}.',
  'Every {0} tells a story; this one pairs the {1} with the {2}, framed by the {3} and the {4}.',
  'Between the {0} and the {1}, the {2} kept pace with the {3} until the {4} closed the scene.',
  'A short lesson on the {0}: watch the {1}, listen for the {2}, and let the {3} settle before the {4}.',
  'The journal entry mentions a {0}, a patient {1}, a restless {2}, a borrowed {3} and a bright {4}.',
  'Morning report — the {0} held steady, the {1} wandered, the {2} surprised us, and the {3} met the {4}.',
];

function buildSampleDocuments(): string[] {
  const rng = mulberry32(20261029);
  const themes = Object.keys(THEME_POOLS);
  const docs: string[] = [];
  for (const theme of themes) {
    const pool = THEME_POOLS[theme]!;
    for (let i = 0; i < 15; i += 1) {
      const picks: string[] = [];
      while (picks.length < 5) {
        const w = pool[Math.floor(rng() * pool.length) % pool.length]!;
        if (!picks.includes(w)) picks.push(w);
      }
      const tpl = TEMPLATES[Math.floor(rng() * TEMPLATES.length) % TEMPLATES.length]!;
      docs.push(
        tpl
          .replace('{0}', picks[0]!)
          .replace('{1}', picks[1]!)
          .replace('{2}', picks[2]!)
          .replace('{3}', picks[3]!)
          .replace('{4}', picks[4]!),
      );
    }
  }
  return docs;
}

/** {"documents":[...]} — 60 seeded English sentences across 4 themes. */
export const VECTORDB_SAMPLE_JSON: string = JSON.stringify({ documents: buildSampleDocuments() }, null, 2);

/** 120 rows x 8 features from 3 seeded clusters, as an f0..f7 CSV. */
export const VECTORDB_SAMPLE_NUMERIC_CSV: string = (() => {
  const rows = generateSyntheticVectors(120, 8, 3, 20261029);
  const header = Array.from({ length: 8 }, (_, i) => `f${i}`).join(',');
  const body = rows.map((r) => r.map((v) => v.toFixed(4)).join(',')).join('\n');
  return `${header}\n${body}\n`;
})();
