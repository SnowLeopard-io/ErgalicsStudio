/** Source-derived counts for the public site.
 *
 *  Every number here mirrors the current checkout, not the previous
 *  marketing copy:
 *    - plugins: entries in src/plugins/builtin/index.ts (BUILTIN_PLUGINS)
 *    - disciplines: keys in src/plugins/categories.ts (DISCIPLINE_BY_PLUGIN)
 *    - tools: RESEARCH_TOOLS in src/pages/research/toolRegistry.ts
 *    - flow blocks: exported BlockDefinition arrays under src/blocks/catalog/
 *    - block-mode blocks: BLOCK_DEFS in src/editor/block/blocks.ts
 *    - WGSL kernels: src/core/wgsl.ts
 *    - tests: `vitest list` output
 */
export const FACTS = {
  plugins: 163,
  disciplines: 19,
  tools: 33,
  toolGroups: 7,
  flowBlocks: 53,
  flowBlockCategories: 8,
  blockModeBlocks: 40,
  blockModeCategories: 10,
  wgslKernels: 14,
  tests: 3878,
  testFiles: 241,
  scientificFormats: 7,
  sampleProjects: 11,
  sampleDataFiles: 193,
} as const;

/** Plugin counts per discipline, sorted descending. Mirrors
 *  src/plugins/categories.ts; the ids double as i18n keys. */
export const DISCIPLINES = [
  { id: 'charts', count: 22 },
  { id: 'math', count: 20 },
  { id: 'physics', count: 17 },
  { id: 'geo', count: 16 },
  { id: 'engineering', count: 11 },
  { id: 'fun', count: 10 },
  { id: 'data', count: 8 },
  { id: 'env', count: 8 },
  { id: 'cs', count: 7 },
  { id: 'fx', count: 7 },
  { id: 'bio', count: 6 },
  { id: 'med', count: 6 },
  { id: 'artsci', count: 5 },
  { id: 'chem', count: 5 },
  { id: 'socio', count: 5 },
  { id: 'astro', count: 3 },
  { id: 'materials', count: 3 },
  { id: 'econ', count: 2 },
  { id: 'psych', count: 2 },
] as const;
