// ==========================================================================
// L4 acceptance cards (FR-6 / FR-7)
//
// One card per high-frequency, compute-heavy plugin. Cards are deliberately
// strict: missing evidence is a FAIL with an explicit reason, never a silent
// green. The Markdown report is the release gate artifact.
// ==========================================================================

export type L4Status = 'PASS' | 'FAIL';

export interface L4Evidence {
  pluginId: string;
  discipline: string;
  /** Recorded default run metrics: key → formatted value. */
  defaultMetrics?: Record<string, string | number>;
  /** At least one non-default parameter run. */
  extremeParams?: Record<string, unknown>;
  extremeMetrics?: Record<string, string | number>;
  export?: {
    /** Page / sidecar / CSV numbers that must agree. */
    page: string[];
    firstLine: string;
    lastLine: string;
    sidecar: string[];
  };
  refresh?: { paramsMatch: boolean; metricsMatch: boolean; detail: string };
  independent?: { expression?: string; expected?: string; actual?: string; detail: string };
  limitations?: string[];
}

export interface L4Card {
  pluginId: string;
  discipline: string;
  status: L4Status;
  reasons: string[];
  evidence: L4Evidence;
}

const same = (a: string | number | undefined, b: string | number | undefined): boolean =>
  a !== undefined && b !== undefined && String(a) === String(b);

export function evaluateL4Card(evidence: L4Evidence): L4Card {
  const reasons: string[] = [];
  if (!evidence.defaultMetrics || Object.keys(evidence.defaultMetrics).length === 0) {
    reasons.push('no default-parameter result was recorded');
  }
  if (
    !evidence.extremeParams ||
    Object.keys(evidence.extremeParams).length === 0 ||
    !evidence.extremeMetrics ||
    Object.keys(evidence.extremeMetrics).length === 0
  ) {
    reasons.push('no extreme-parameter result was recorded');
  }
  const exp = evidence.export;
  if (!exp || exp.page.length === 0 || !exp.firstLine || !exp.lastLine) {
    reasons.push('no export reconciliation table (page / first row / last row / sidecar)');
  } else {
    if (!same(exp.page[0], exp.firstLine) || !same(exp.page[exp.page.length - 1], exp.lastLine)) {
      reasons.push('export CSV first/last row does not match the page numbers');
    }
    if (exp.sidecar.length !== exp.page.length || exp.sidecar.some((v, i) => !same(v, exp.page[i]))) {
      reasons.push('sidecar metrics differ from the page numbers');
    }
  }
  if (!evidence.refresh?.paramsMatch || !evidence.refresh.metricsMatch) {
    reasons.push(`refresh restoration incomplete: ${evidence.refresh?.detail ?? 'no evidence'}`);
  }
  if (!evidence.independent?.detail) {
    reasons.push('independent recomputation was not documented');
  } else if (
    evidence.independent.expected !== undefined &&
    !same(evidence.independent.expected, evidence.independent.actual)
  ) {
    reasons.push(
      `independent recomputation mismatch: expected ${evidence.independent.expected}, ` +
        `got ${evidence.independent.actual}`,
    );
  }
  if (!evidence.limitations || evidence.limitations.length === 0) {
    reasons.push('known limitations / out-of-scope scenarios were not documented');
  }

  return {
    pluginId: evidence.pluginId,
    discipline: evidence.discipline,
    status: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons,
    evidence,
  };
}

function valueTable(values?: Record<string, string | number>): string {
  if (!values || Object.keys(values).length === 0) return '_not recorded_';
  const rows = Object.entries(values).map(([k, v]) => `| ${k} | ${v} |`);
  return `| metric | value |\n| --- | --- |\n${rows.join('\n')}`;
}

export function renderL4Card(card: L4Card): string {
  const e = card.evidence;
  const exp = e.export;
  const reconciliation = exp
    ? `| metric | page | export first | export last | sidecar |\n| --- | --- | --- | --- | --- |\n` +
      exp.page
        .map(
          (v, i) =>
            `| ${i} | ${v} | ${i === 0 ? exp.firstLine : '—'} | ${
              i === exp.page.length - 1 ? exp.lastLine : '—'
            } | ${exp.sidecar[i] ?? '—'} |`,
        )
        .join('\n')
    : '_not recorded_';

  return [
    `## ${card.pluginId} — ${card.status}`,
    '',
    `- Discipline: ${card.discipline}`,
    `- Default parameters: ${valueTable(e.defaultMetrics)}`,
    `- Extreme parameters: \`${JSON.stringify(e.extremeParams ?? {})}\``,
    `- Extreme results: ${valueTable(e.extremeMetrics)}`,
    '',
    '### Export reconciliation',
    '',
    reconciliation,
    '',
    '### Refresh restoration',
    '',
    e.refresh
      ? `- params: ${e.refresh.paramsMatch ? 'restored' : 'NOT restored'}; metrics: ${
          e.refresh.metricsMatch ? 'restored' : 'NOT restored'
        }; ${e.refresh.detail}`
      : '_not recorded_',
    '',
    '### Independent recomputation',
    '',
    e.independent
      ? `- ${e.independent.detail}${
          e.independent.expression ? ` (expression: \`${e.independent.expression}\`)` : ''
        }`
      : '_not recorded_',
    '',
    '### Known limitations',
    '',
    ...(e.limitations?.length ? e.limitations.map((l) => `- ${l}`) : ['_not documented_']),
    '',
    ...(card.reasons.length ? card.reasons.map((r) => `- **FAIL reason:** ${r}`) : []),
    '',
  ].join('\n');
}

export function renderL4Report(cards: L4Card[]): string {
  const passed = cards.filter((c) => c.status === 'PASS').length;
  return [
    '# L4 acceptance report',
    '',
    `Plugins: ${cards.length} · PASS: ${passed} · FAIL: ${cards.length - passed}`,
    '',
    'Release gate: any FAIL blocks publication.',
    '',
    ...cards.map(renderL4Card),
  ].join('\n');
}
