// ==========================================================================
// Ergalics Studio Plugin SDK — Chart Theme Palette Bridge (IoC)
//
// Allows the host's active theme pack (FR-21) to supply advisory chart series
// colours to the pure plotting engine without coupling `@ergalics/plugin-sdk`
// to host theme storage or DOM stylesheets.
// ==========================================================================

export const DEFAULT_CHART_PALETTE: readonly string[] = Object.freeze([
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
]);

export type ChartPaletteProvider = (index: number) => string;

let provider: ChartPaletteProvider | null = null;

export function setChartPaletteProvider(next: ChartPaletteProvider | null): void {
  provider = next;
}

export function chartColorAt(index: number): string {
  if (provider) return provider(index);
  const n = DEFAULT_CHART_PALETTE.length;
  return DEFAULT_CHART_PALETTE[((index % n) + n) % n]!;
}
