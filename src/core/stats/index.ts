// Ergalics Studio — statistics kernel (pure TypeScript, no WASM).
//
// Public surface for the stats subsystem. Consumes plain numeric arrays /
// `DataTable` / `Dataset` and returns structured results. Pair with the
// hypothesis tests in `tests.ts` and effect sizes in `effect.ts`.

export * from './special';
export * from './descriptive';
export * from './tests';
export * from './effect';
export * from './correction';
export * from './power';
